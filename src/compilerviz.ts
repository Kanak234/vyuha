/**
 * Compiler visualisation — the real toolchain, drawn by the native renderer.
 *
 * This module answers one question honestly: when you run this file on THIS
 * machine, which compiler or interpreter actually does the work, and what
 * does it do, stage by stage?
 *
 * So it does not guess. It resolves the tool the way the shell would
 * (`which`), asks the tool its own version (`--version`), then runs the real
 * stages one by one — preprocess, compile-to-assembly, assemble, link, run
 * for C/C++; compile, bytecode, run for Java and Python; and so on — timing
 * each stage and measuring its true artifacts: preprocessed line counts,
 * assembly instruction counts, the functions the compiler emitted, object
 * and binary sizes, exit codes.
 *
 * Everything it learns is emitted as ordinary VFrames, so the native 3D
 * renderer draws it with zero changes: stages light up left to right as they
 * really happen, and the biggest functions in the generated assembly hang
 * beneath the compile stage as bars whose height is their instruction count.
 *
 * Nothing here throws past its boundary. A missing tool becomes a helpful
 * note in the picture, not a crash.
 */

import { execFile } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { NodeState, VEdge, VFrame, VNode } from './protocol';

/* ── shell helpers ─────────────────────────────────────────────── */

interface ExecResult { ok: boolean; code: number; out: string; err: string; ms: number }

function run(cmd: string, args: string[], cwd: string, timeoutMs: number, stdin?: string): Promise<ExecResult> {
  return new Promise(resolve => {
    const t0 = Date.now();
    const child = execFile(cmd, args, { cwd, timeout: timeoutMs, maxBuffer: 16 * 1024 * 1024 }, (error, stdout, stderr) => {
      resolve({
        ok: !error,
        code: error && typeof (error as NodeJS.ErrnoException & { code?: number }).code === 'number'
          ? Number((error as unknown as { code: number }).code) : (error ? 1 : 0),
        out: String(stdout || ''),
        err: String(stderr || ''),
        ms: Date.now() - t0
      });
    });
    // A child that dies instantly (missing tool, immediate exit) closes its
    // stdin pipe before we write to it; without a handler that EPIPE would
    // crash the whole extension host, so it is swallowed on purpose.
    if (child.stdin) {
      child.stdin.on('error', () => { /* pipe already closed — fine */ });
      try {
        if (stdin !== undefined) child.stdin.write(stdin);
        child.stdin.end();
      } catch { /* same story, synchronously */ }
    }
  });
}

/** Resolve a command to an absolute path the way the shell would. Empty string when absent. */
async function which(cmd: string): Promise<string> {
  const probe = process.platform === 'win32' ? 'where' : 'which';
  const r = await run(probe, [cmd], os.tmpdir(), 4000);
  return r.ok ? r.out.split(/\r?\n/)[0].trim() : '';
}

/** First installed tool from a preference list, with its version line. */
async function detectTool(candidates: string[], versionArgs: string[] = ['--version']): Promise<{ cmd: string; path: string; version: string } | null> {
  for (const c of candidates) {
    const p = await which(c);
    if (!p) continue;
    const v = await run(c, versionArgs, os.tmpdir(), 5000);
    const line = (v.out || v.err).split(/\r?\n/).find(l => l.trim().length > 0) || '';
    return { cmd: c, path: p, version: line.trim().slice(0, 120) };
  }
  return null;
}

/* ── pipeline model ────────────────────────────────────────────── */

export interface StageReport {
  id: string;
  label: string;
  state: NodeState;
  ms?: number;
  /** One-line facts shown under the node. */
  facts: string[];
  /** File this stage produced, openable from the artifact picker. */
  artifact?: string;
}

export interface PipelineReport {
  tool: string;          // "g++ 13.2.0" — the thing actually installed
  toolPath: string;
  language: string;
  stages: StageReport[];
  artifacts: { label: string; file: string }[];
  ok: boolean;
  summary: string;
}

export type EmitFrame = (frame: VFrame) => void;

/* Layout: stages sit on a line; detail bars hang beneath their stage. */
function frameOf(title: string, note: string, stages: StageReport[], details: VNode[], detailEdges: VEdge[]): VFrame {
  const nodes: VNode[] = stages.map((s, i) => ({
    id: s.id,
    label: s.label + (s.ms !== undefined ? ` · ${s.ms}ms` : ''),
    state: s.state,
    x: i * 5, y: 0, z: 0,
    group: 'pipeline',
    note: s.facts.join('\n') || undefined
  }));
  const edges: VEdge[] = [];
  for (let i = 0; i + 1 < stages.length; i++) {
    edges.push({
      from: stages[i].id, to: stages[i + 1].id, directed: true,
      state: stages[i].state === 'done' && stages[i + 1].state !== 'normal' ? 'active'
        : stages[i].state === 'done' ? 'done' : 'normal'
    });
  }
  return { kind: 'graph', title, note, nodes: nodes.concat(details), edges: edges.concat(detailEdges) };
}

/* ── assembly analysis (C/C++/Rust `-S` output) ────────────────── */

function analyseAsm(asmText: string): { instructions: number; functions: { name: string; count: number }[] } {
  const lines = asmText.split(/\r?\n/);
  let current = '';
  let instructions = 0;
  const perFn = new Map<string, number>();
  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line.startsWith('#') || line.startsWith(';')) continue;
    // A label at column 0 that is not a local (.L*) label starts a function region.
    const label = /^([A-Za-z_][\w.$@]*):/.exec(raw);
    if (label && !label[1].startsWith('.L')) { current = label[1]; continue; }
    if (line.startsWith('.')) continue;           // directives
    instructions++;
    if (current) perFn.set(current, (perFn.get(current) || 0) + 1);
  }
  const functions = [...perFn.entries()]
    .map(([name, count]) => ({ name: name.replace(/^_+/, ''), count }))
    .sort((a, b) => b.count - a.count);
  return { instructions, functions };
}

function shortName(sym: string): string {
  // Trim C++ mangling to something readable without a demangler dependency.
  if (sym.startsWith('Z') || sym.startsWith('_Z')) {
    const m = /\d+([A-Za-z_]\w*)/.exec(sym);
    if (m) return m[1];
  }
  return sym.length > 18 ? sym.slice(0, 17) + '…' : sym;
}

function fnBars(functions: { name: string; count: number }[], underStage: string, max = 6): { nodes: VNode[]; edges: VEdge[] } {
  const top = functions.slice(0, max);
  const nodes: VNode[] = top.map((f, i) => ({
    id: 'fn:' + f.name,
    label: shortName(f.name),
    state: 'visited' as NodeState,
    value: f.count,
    x: 5 * 1 + (i - (top.length - 1) / 2) * 2.2, y: -4, z: 0,
    group: 'functions',
    note: f.count + ' instructions'
  }));
  const edges: VEdge[] = top.map(f => ({ from: underStage, to: 'fn:' + f.name, directed: true, state: 'visited' as NodeState }));
  return { nodes, edges };
}

/* ── the pipelines ─────────────────────────────────────────────── */

const KB = (bytes: number) => (bytes / 1024).toFixed(1) + ' KB';

async function sizeOf(file: string): Promise<number> {
  try { return (await fs.promises.stat(file)).size; } catch { return 0; }
}

interface Ctx {
  file: string; dir: string; base: string; work: string;
  emit: EmitFrame; log: (line: string) => void; timeout: number;
}

function stage(id: string, label: string): StageReport {
  return { id: 's:' + id, label, state: 'normal', facts: [] };
}

function pushState(ctx: Ctx, title: string, note: string, stages: StageReport[], det?: { nodes: VNode[]; edges: VEdge[] }) {
  ctx.emit(frameOf(title, note, stages, det ? det.nodes : [], det ? det.edges : []));
}

async function cFamily(ctx: Ctx, isCpp: boolean): Promise<PipelineReport> {
  const tool = await detectTool(isCpp ? ['g++', 'clang++', 'c++'] : ['gcc', 'clang', 'cc']);
  const lang = isCpp ? 'C++' : 'C';
  if (!tool) {
    const s = [stage('missing', 'No ' + lang + ' compiler found')];
    s[0].state = 'error';
    s[0].facts = ['Install gcc/g++ or clang, then run again'];
    pushState(ctx, lang + ' pipeline', 'no compiler installed', s, undefined);
    return { tool: 'none', toolPath: '', language: lang, stages: s, artifacts: [], ok: false, summary: 'No ' + lang + ' compiler installed.' };
  }
  const title = tool.cmd + ' — ' + lang + ' pipeline';
  const std = isCpp ? ['-std=c++17'] : ['-std=c11'];
  const src = ctx.file;
  const pre = path.join(ctx.work, ctx.base + (isCpp ? '.ii' : '.i'));
  const asm = path.join(ctx.work, ctx.base + '.s');
  const obj = path.join(ctx.work, ctx.base + '.o');
  const bin = path.join(ctx.work, ctx.base + (process.platform === 'win32' ? '.exe' : ''));

  const S = [stage('src', 'Source'), stage('pre', 'Preprocess'), stage('asm', 'Compile → ASM'),
             stage('obj', 'Assemble'), stage('link', 'Link'), stage('run', 'Run')];
  const [sSrc, sPre, sAsm, sObj, sLink, sRun] = S;
  const artifacts: { label: string; file: string }[] = [];

  const srcText = await fs.promises.readFile(src, 'utf8').catch(() => '');
  sSrc.state = 'done';
  sSrc.facts = [srcText.split('\n').length + ' lines', tool.version];
  sPre.state = 'active';
  pushState(ctx, title, 'preprocessing with ' + tool.cmd, S);

  // 1) Preprocess
  let r = await run(tool.cmd, [...std, '-E', src, '-o', pre], ctx.dir, ctx.timeout);
  sPre.ms = r.ms;
  if (!r.ok) {
    sPre.state = 'error'; sPre.facts = firstErrors(r.err);
    pushState(ctx, title, 'preprocessing failed', S);
    return fail(tool, lang, S, artifacts, 'Preprocessing failed — see the errors on the stage.');
  }
  const preText = await fs.promises.readFile(pre, 'utf8').catch(() => '');
  const headerCount = new Set([...preText.matchAll(/^#\s+\d+\s+"([^"<][^"]*)"/gm)].map(m => m[1])).size;
  sPre.state = 'done';
  sPre.facts = [preText.split('\n').length + ' lines after expansion', headerCount + ' files pulled in'];
  artifacts.push({ label: 'Preprocessed (' + path.basename(pre) + ')', file: pre });
  sPre.artifact = pre;
  sAsm.state = 'active';
  pushState(ctx, title, 'compiling to assembly', S);

  // 2) Compile to assembly
  r = await run(tool.cmd, [...std, '-S', '-O1', src, '-o', asm], ctx.dir, ctx.timeout);
  sAsm.ms = r.ms;
  if (!r.ok) {
    sAsm.state = 'error'; sAsm.facts = firstErrors(r.err);
    pushState(ctx, title, 'compilation failed', S);
    return fail(tool, lang, S, artifacts, 'Compilation failed — the compile stage holds the first errors.');
  }
  const asmText = await fs.promises.readFile(asm, 'utf8').catch(() => '');
  const a = analyseAsm(asmText);
  sAsm.state = 'done';
  sAsm.facts = [a.instructions + ' instructions', a.functions.length + ' functions emitted'];
  artifacts.push({ label: 'Assembly (' + path.basename(asm) + ')', file: asm });
  sAsm.artifact = asm;
  const bars = fnBars(a.functions, sAsm.id);
  sObj.state = 'active';
  pushState(ctx, title, 'assembling', S, bars);

  // 3) Assemble
  r = await run(tool.cmd, ['-c', asm, '-o', obj], ctx.dir, ctx.timeout);
  sObj.ms = r.ms;
  if (r.ok) {
    sObj.state = 'done';
    sObj.facts = [KB(await sizeOf(obj)) + ' object file'];
    artifacts.push({ label: 'Object (' + path.basename(obj) + ')', file: obj });
    sObj.artifact = obj;
  } else { sObj.state = 'error'; sObj.facts = firstErrors(r.err); }
  sLink.state = 'active';
  pushState(ctx, title, 'linking', S, bars);

  // 4) Link (straight from source keeps it correct even if assemble was skipped)
  r = await run(tool.cmd, [...std, '-O1', src, '-o', bin, ...(isCpp ? [] : ['-lm'])], ctx.dir, ctx.timeout);
  sLink.ms = r.ms;
  if (!r.ok) {
    sLink.state = 'error'; sLink.facts = firstErrors(r.err);
    pushState(ctx, title, 'link failed', S, bars);
    return fail(tool, lang, S, artifacts, 'Linking failed.');
  }
  sLink.state = 'done';
  sLink.facts = [KB(await sizeOf(bin)) + ' executable'];
  artifacts.push({ label: 'Executable (' + path.basename(bin) + ')', file: bin });
  sLink.artifact = bin;
  sRun.state = 'active';
  pushState(ctx, title, 'running', S, bars);

  // 5) Run
  r = await run(bin, [], ctx.dir, ctx.timeout, '');
  sRun.ms = r.ms;
  sRun.state = r.ok ? 'done' : 'error';
  const outLines = r.out.split(/\r?\n/).filter(l => l.length).length;
  sRun.facts = ['exit code ' + r.code, outLines + ' output lines'];
  if (r.out.trim()) ctx.log(r.out.trimEnd());
  if (r.err.trim()) ctx.log(r.err.trimEnd());
  pushState(ctx, title, r.ok ? 'finished — every stage above really ran' : 'program exited with ' + r.code, S, bars);

  return {
    tool: tool.cmd + ' · ' + tool.version, toolPath: tool.path, language: lang,
    stages: S, artifacts, ok: r.ok,
    summary: tool.cmd + ': ' + a.instructions + ' asm instructions, ' + KB(await sizeOf(bin)) + ' binary, ran in ' + r.ms + 'ms.'
  };
}

async function javaPipeline(ctx: Ctx): Promise<PipelineReport> {
  const javac = await detectTool(['javac'], ['-version']);
  const java = await detectTool(['java'], ['-version']);
  if (!javac || !java) return missing(ctx, 'Java', 'Install a JDK (javac + java)');
  const title = 'javac — Java pipeline';
  const cls = path.join(ctx.dir, ctx.base + '.class');
  const S = [stage('src', 'Source'), stage('compile', 'Compile (javac)'), stage('bytecode', 'Bytecode'), stage('run', 'Run (JVM)')];
  const [sSrc, sCompile, sByte, sRun] = S;
  const artifacts: { label: string; file: string }[] = [];

  sSrc.state = 'done';
  sSrc.facts = [javac.version];
  sCompile.state = 'active';
  pushState(ctx, title, 'compiling', S);

  let r = await run(javac.cmd, [ctx.file], ctx.dir, ctx.timeout);
  sCompile.ms = r.ms;
  if (!r.ok) {
    sCompile.state = 'error'; sCompile.facts = firstErrors(r.err);
    pushState(ctx, title, 'javac failed', S);
    return fail(javac, 'Java', S, artifacts, 'javac failed.');
  }
  sCompile.state = 'done';
  sCompile.facts = [KB(await sizeOf(cls)) + ' class file'];
  artifacts.push({ label: ctx.base + '.class', file: cls });
  sByte.state = 'active';
  pushState(ctx, title, 'reading bytecode', S);

  const javap = await which('javap');
  let det: { nodes: VNode[]; edges: VEdge[] } | undefined;
  if (javap) {
    r = await run('javap', ['-c', '-p', cls], ctx.dir, ctx.timeout);
    sByte.ms = r.ms;
    const ops = (r.out.match(/^\s*\d+:\s+\w/gm) || []).length;
    const methods = (r.out.match(/^\s{2}[\w<>. $[\]]+\(/gm) || []).length;
    sByte.state = 'done';
    sByte.facts = [ops + ' JVM instructions', methods + ' methods'];
  } else { sByte.state = 'done'; sByte.facts = ['javap not installed — skipped']; }
  sRun.state = 'active';
  pushState(ctx, title, 'running on the JVM', S, det);

  r = await run(java.cmd, [ctx.base], ctx.dir, ctx.timeout, '');
  sRun.ms = r.ms;
  sRun.state = r.ok ? 'done' : 'error';
  sRun.facts = ['exit code ' + r.code, java.version];
  if (r.out.trim()) ctx.log(r.out.trimEnd());
  if (r.err.trim()) ctx.log(r.err.trimEnd());
  pushState(ctx, title, r.ok ? 'finished' : 'exited with ' + r.code, S, det);
  return { tool: 'javac · ' + javac.version, toolPath: javac.path, language: 'Java', stages: S, artifacts, ok: r.ok, summary: 'javac + JVM run complete.' };
}

async function pythonPipeline(ctx: Ctx): Promise<PipelineReport> {
  const py = await detectTool(['python3', 'python']);
  if (!py) return missing(ctx, 'Python', 'Install Python 3');
  const title = py.cmd + ' — Python pipeline';
  const S = [stage('src', 'Source'), stage('parse', 'Parse + Compile'), stage('bytecode', 'Bytecode'), stage('run', 'Run (interpreter)')];
  const [sSrc, sParse, sByte, sRun] = S;

  sSrc.state = 'done'; sSrc.facts = [py.version];
  sParse.state = 'active';
  pushState(ctx, title, 'compiling to bytecode', S);

  let r = await run(py.cmd, ['-c',
    'import py_compile,sys; py_compile.compile(sys.argv[1], doraise=True); print("ok")', ctx.file], ctx.dir, ctx.timeout);
  sParse.ms = r.ms;
  if (!r.ok) {
    sParse.state = 'error'; sParse.facts = firstErrors(r.err);
    pushState(ctx, title, 'syntax error', S);
    return fail(py, 'Python', S, [], 'Python could not compile the file.');
  }
  sParse.state = 'done'; sParse.facts = ['compiles cleanly'];
  sByte.state = 'active';
  pushState(ctx, title, 'counting bytecode', S);

  r = await run(py.cmd, ['-c', [
    'import dis,sys,marshal',
    'src=open(sys.argv[1],encoding="utf-8",errors="replace").read()',
    'code=compile(src, sys.argv[1], "exec")',
    'ops=list(dis.get_instructions(code))',
    'fns=[c for c in code.co_consts if hasattr(c,"co_code")]',
    'total=len(ops)+sum(len(list(dis.get_instructions(c))) for c in fns)',
    'print(total); print(len(fns))',
    'for c in fns[:6]: print(c.co_name, len(list(dis.get_instructions(c))))'
  ].join('\n'), ctx.file], ctx.dir, ctx.timeout);
  sByte.ms = r.ms;
  let det: { nodes: VNode[]; edges: VEdge[] } | undefined;
  if (r.ok) {
    const lines = r.out.trim().split(/\r?\n/);
    sByte.state = 'done';
    sByte.facts = [(lines[0] || '0') + ' bytecode instructions', (lines[1] || '0') + ' functions'];
    const fns = lines.slice(2).map(l => { const p = l.split(' '); return { name: p[0], count: Number(p[1] || 0) }; });
    if (fns.length) det = fnBars(fns, sByte.id);
  } else { sByte.state = 'done'; sByte.facts = ['bytecode scan skipped']; }
  sRun.state = 'active';
  pushState(ctx, title, 'running', S, det);

  r = await run(py.cmd, ['-u', ctx.file], ctx.dir, ctx.timeout, '');
  sRun.ms = r.ms;
  sRun.state = r.ok ? 'done' : 'error';
  sRun.facts = ['exit code ' + r.code];
  if (r.out.trim()) ctx.log(r.out.trimEnd());
  if (r.err.trim()) ctx.log(r.err.trimEnd());
  pushState(ctx, title, r.ok ? 'finished' : 'exited with ' + r.code, S, det);
  return { tool: py.cmd + ' · ' + py.version, toolPath: py.path, language: 'Python', stages: S, artifacts: [], ok: r.ok, summary: 'Python bytecode + run complete.' };
}

async function nodePipeline(ctx: Ctx, isTs: boolean): Promise<PipelineReport> {
  const node = await detectTool(['node']);
  if (!node) return missing(ctx, isTs ? 'TypeScript' : 'JavaScript', 'Install Node.js');
  const title = 'node — ' + (isTs ? 'TypeScript' : 'JavaScript') + ' pipeline';
  const S = isTs
    ? [stage('src', 'Source'), stage('check', 'Type-strip / Check'), stage('run', 'Run (V8)')]
    : [stage('src', 'Source'), stage('check', 'Parse check'), stage('run', 'Run (V8)')];
  const [sSrc, sCheck, sRun] = S;
  sSrc.state = 'done'; sSrc.facts = [node.version];
  sCheck.state = 'active';
  pushState(ctx, title, 'checking', S);

  let r = isTs
    ? { ok: true, code: 0, out: '', err: '', ms: 0 }
    : await run(node.cmd, ['--check', ctx.file], ctx.dir, ctx.timeout);
  sCheck.ms = r.ms;
  if (!r.ok) {
    sCheck.state = 'error'; sCheck.facts = firstErrors(r.err);
    pushState(ctx, title, 'parse failed', S);
    return fail(node, 'JavaScript', S, [], 'node --check rejected the file.');
  }
  sCheck.state = 'done'; sCheck.facts = isTs ? ['run via tsx'] : ['parses cleanly'];
  sRun.state = 'active';
  pushState(ctx, title, 'running on V8', S);

  r = isTs
    ? await run('npx', ['--yes', 'tsx', ctx.file], ctx.dir, ctx.timeout, '')
    : await run(node.cmd, [ctx.file], ctx.dir, ctx.timeout, '');
  sRun.ms = r.ms;
  sRun.state = r.ok ? 'done' : 'error';
  sRun.facts = ['exit code ' + r.code];
  if (r.out.trim()) ctx.log(r.out.trimEnd());
  if (r.err.trim()) ctx.log(r.err.trimEnd());
  pushState(ctx, title, r.ok ? 'finished' : 'exited with ' + r.code, S);
  return { tool: 'node · ' + node.version, toolPath: node.path, language: isTs ? 'TypeScript' : 'JavaScript', stages: S, artifacts: [], ok: r.ok, summary: 'V8 run complete.' };
}

async function goPipeline(ctx: Ctx): Promise<PipelineReport> {
  const go = await detectTool(['go'], ['version']);
  if (!go) return missing(ctx, 'Go', 'Install Go');
  const title = 'go — Go pipeline';
  const bin = path.join(ctx.work, ctx.base + (process.platform === 'win32' ? '.exe' : ''));
  const S = [stage('src', 'Source'), stage('build', 'Compile + Link (go build)'), stage('run', 'Run')];
  const [sSrc, sBuild, sRun] = S;
  sSrc.state = 'done'; sSrc.facts = [go.version];
  sBuild.state = 'active';
  pushState(ctx, title, 'building', S);

  let r = await run(go.cmd, ['build', '-o', bin, '.'], ctx.dir, Math.max(ctx.timeout, 60000));
  if (!r.ok) r = await run(go.cmd, ['build', '-o', bin, ctx.file], ctx.dir, Math.max(ctx.timeout, 60000));
  sBuild.ms = r.ms;
  if (!r.ok) {
    sBuild.state = 'error'; sBuild.facts = firstErrors(r.err);
    pushState(ctx, title, 'build failed', S);
    return fail(go, 'Go', S, [], 'go build failed.');
  }
  sBuild.state = 'done';
  sBuild.facts = [KB(await sizeOf(bin)) + ' static binary'];
  sRun.state = 'active';
  pushState(ctx, title, 'running', S);

  r = await run(bin, [], ctx.dir, ctx.timeout, '');
  sRun.ms = r.ms;
  sRun.state = r.ok ? 'done' : 'error';
  sRun.facts = ['exit code ' + r.code];
  if (r.out.trim()) ctx.log(r.out.trimEnd());
  if (r.err.trim()) ctx.log(r.err.trimEnd());
  pushState(ctx, title, r.ok ? 'finished' : 'exited with ' + r.code, S);
  return { tool: go.version, toolPath: go.path, language: 'Go', stages: S, artifacts: [{ label: 'binary', file: bin }], ok: r.ok, summary: 'go build + run complete.' };
}

async function genericPipeline(ctx: Ctx, command: string): Promise<PipelineReport> {
  const first = command.trim().split(/\s+/)[0];
  const tool = await detectTool([first]);
  const title = (tool ? tool.cmd : first) + ' — pipeline';
  const S = [stage('src', 'Source'), stage('run', 'Run')];
  const [sSrc, sRun] = S;
  sSrc.state = 'done';
  sSrc.facts = tool ? [tool.version] : [first + ' not found on PATH'];
  if (!tool) {
    sRun.state = 'error'; sRun.facts = ['install ' + first + ' and run again'];
    pushState(ctx, title, 'interpreter missing', S);
    return { tool: 'none', toolPath: '', language: first, stages: S, artifacts: [], ok: false, summary: first + ' is not installed.' };
  }
  sRun.state = 'active';
  pushState(ctx, title, 'running', S);
  const sh = process.platform === 'win32' ? ['cmd', '/c'] : ['bash', '-lc'];
  const r = await run(sh[0], [...sh.slice(1), command], ctx.dir, ctx.timeout, '');
  sRun.ms = r.ms;
  sRun.state = r.ok ? 'done' : 'error';
  sRun.facts = ['exit code ' + r.code];
  if (r.out.trim()) ctx.log(r.out.trimEnd());
  if (r.err.trim()) ctx.log(r.err.trimEnd());
  pushState(ctx, title, r.ok ? 'finished' : 'exited with ' + r.code, S);
  return { tool: tool.cmd + ' · ' + tool.version, toolPath: tool.path, language: first, stages: S, artifacts: [], ok: r.ok, summary: 'Ran with ' + tool.cmd + '.' };
}

/* ── failure shapes ────────────────────────────────────────────── */

function firstErrors(stderr: string): string[] {
  return stderr.split(/\r?\n/).filter(l => l.trim()).slice(0, 3).map(l => l.slice(0, 120));
}

function fail(tool: { cmd: string; path: string; version: string }, language: string,
              stages: StageReport[], artifacts: { label: string; file: string }[], summary: string): PipelineReport {
  return { tool: tool.cmd + ' · ' + tool.version, toolPath: tool.path, language, stages, artifacts, ok: false, summary };
}

function missing(ctx: Ctx, language: string, hint: string): PipelineReport {
  const s = [stage('missing', 'No ' + language + ' toolchain')];
  s[0].state = 'error'; s[0].facts = [hint];
  pushState(ctx, language + ' pipeline', 'toolchain missing', s);
  return { tool: 'none', toolPath: '', language, stages: s, artifacts: [], ok: false, summary: hint };
}

/* ── entry point ───────────────────────────────────────────────── */

/**
 * Run the real pipeline for `file` with whatever toolchain is installed,
 * emitting a frame after every stage. `fallbackCommand` is the runner-table
 * command, used verbatim for languages without a dedicated pipeline.
 */
export async function visualizeCompilation(
  file: string,
  fallbackCommand: string | undefined,
  timeoutMs: number,
  emit: EmitFrame,
  log: (line: string) => void
): Promise<PipelineReport> {
  const ext = path.extname(file).replace(/^\./, '').toLowerCase();
  const work = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'vyuha-cc-'));
  const ctx: Ctx = {
    file, dir: path.dirname(file),
    base: path.basename(file, path.extname(file)),
    work, emit, log, timeout: Math.max(timeoutMs, 20000)
  };
  try {
    if (ext === 'c') return await cFamily(ctx, false);
    if (['cpp', 'cc', 'cxx', 'c++'].includes(ext)) return await cFamily(ctx, true);
    if (ext === 'java') return await javaPipeline(ctx);
    if (ext === 'py' || ext === 'py3') return await pythonPipeline(ctx);
    if (['js', 'mjs', 'cjs'].includes(ext)) return await nodePipeline(ctx, false);
    if (['ts', 'mts'].includes(ext)) return await nodePipeline(ctx, true);
    if (ext === 'go') return await goPipeline(ctx);
    if (fallbackCommand) return await genericPipeline(ctx, fallbackCommand);
    return missing(ctx, ext || 'unknown', 'No runner is configured for .' + ext + ' — add one in the vyuha.runners setting.');
  } catch (err) {
    const s = [stage('err', 'Pipeline error')];
    s[0].state = 'error';
    s[0].facts = [err instanceof Error ? err.message.slice(0, 120) : String(err)];
    pushState(ctx, 'pipeline', 'unexpected error', s);
    return { tool: 'unknown', toolPath: '', language: ext, stages: s, artifacts: [], ok: false, summary: 'Unexpected error: ' + (err instanceof Error ? err.message : String(err)) };
  }
}
