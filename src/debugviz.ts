/**
 * Debugger-driven visualisation.
 *
 * The rest of VYUHA asks the program to describe itself by printing @vyuha
 * lines. This module asks nothing of the program at all: it runs the program
 * under a real debugger, steps through it, and turns what the debugger reports
 * — the live call stack and the values of local variables — into the same
 * VFrames the native 3D renderer already draws.
 *
 * Two backends:
 *   • Python — a self-contained tracer script driven by sys.settrace, launched
 *     with the user's own python3. No pip packages, works everywhere Python
 *     does. It emits a frame on every line and every call/return.
 *   • C / C++ — GDB in batch mode (gdb --batch with a generated command file),
 *     stepping line by line and printing the stack and locals, which this
 *     module parses into frames. Requires gdb on PATH.
 *
 * A "frame" here is the call stack drawn as a vertical tower of stack frames,
 * with each frame's local variables hanging beside it as labelled nodes whose
 * values update as the program runs. Watched containers (lists, arrays) are
 * drawn element by element so you can watch them fill and sort.
 */

import { resolvePython, pythonInstallHint } from './interpreters';
import { execFile, execFileSync, spawn } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { VEdge, VFrame, VNode } from './protocol';

export type DebugEmit = (frame: VFrame) => void;

export interface DebugResult {
  ok: boolean;
  language: string;
  tool: string;
  frames: number;
  summary: string;
  exitCode: number | null;
}

/** vyuha.pythonPath setting (vscode yahan optional hai — Node tests mein nahi hota) */
function pythonPathSetting(): string {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const vs = require('vscode');
    return vs.workspace.getConfiguration('vyuha').get('pythonPath', '') || '';
  } catch { return ''; }
}

/** OS se ek khaali TCP port lo (sync — extension host Electron ko Node ki tarah chala kar) */
function freePort(): number {
  try {
    const out = execFileSync(process.execPath, ['-e',
      "const s=require('net').createServer();s.listen(0,'127.0.0.1',()=>{process.stdout.write(String(s.address().port));s.close();})"],
      { encoding: 'utf8', timeout: 5000, env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' } });
    const n = Number(out.trim());
    if (n > 0) return n;
  } catch { /* fallback neeche */ }
  return 20000 + Math.floor(Math.random() * 30000);
}

function which(cmd: string): string {
  try {
    const probe = process.platform === 'win32' ? 'where' : 'which';
    return String(execFileSync(probe, [cmd], { encoding: 'utf8' })).split(/\r?\n/)[0].trim();
  } catch { return ''; }
}

/* ── the Python tracer, embedded verbatim ──────────────────────────
 * This runs in the user's interpreter. It prints one JSON line per step to
 * stderr (stdout stays the program's own), which the extension parses. It is
 * intentionally dependency-free and defensive: a program that never defines a
 * watched variable simply produces frames without it.
 */
const PY_TRACER = String.raw`
import sys, json, os

TARGET = sys.argv[1]
MAXSTEPS = int(os.environ.get("VYUHA_MAX_STEPS", "4000"))
# only trace user code in the target file, never library internals
_target_abs = os.path.abspath(TARGET)
_steps = 0
_emitted = 0

def _val(v):
    try:
        if isinstance(v, bool) or v is None or isinstance(v, (int, float)):
            return v
        if isinstance(v, str):
            return v if len(v) <= 40 else v[:39] + "\u2026"
        if isinstance(v, (list, tuple)):
            return [_val(x) for x in v[:32]]
        if isinstance(v, dict):
            return {str(k)[:16]: _val(x) for k, x in list(v.items())[:16]}
        r = repr(v)
        return r if len(r) <= 40 else r[:39] + "\u2026"
    except Exception:
        return "<?>"

def _emit(kind, payload):
    payload["__vyuha_dbg"] = kind
    sys.stderr.write("##VYUHADBG##" + json.dumps(payload, default=str) + "\n")
    sys.stderr.flush()

def _stack_frames(frame):
    # walk from outermost user frame to current
    chain = []
    f = frame
    while f is not None:
        code = f.f_code
        if os.path.abspath(code.co_filename) == _target_abs:
            chain.append(f)
        f = f.f_back
    chain.reverse()
    out = []
    for f in chain:
        locs = {}
        for k, v in list(f.f_locals.items()):
            if k.startswith("__"):
                continue
            locs[k] = _val(v)
        out.append({
            "func": f.f_code.co_name,
            "line": f.f_lineno,
            "locals": locs
        })
    return out

def _tracer(frame, event, arg):
    global _steps, _emitted
    if os.path.abspath(frame.f_code.co_filename) != _target_abs:
        return _tracer
    if event not in ("line", "call", "return"):
        return _tracer
    _steps += 1
    if _steps > MAXSTEPS:
        return None
    stack = _stack_frames(frame)
    ret = _val(arg) if event == "return" else None
    _emit("step", {"event": event, "line": frame.f_lineno,
                   "func": frame.f_code.co_name, "stack": stack, "ret": ret})
    _emitted += 1
    return _tracer

def _run():
    g = {"__name__": "__main__", "__file__": TARGET}
    with open(TARGET, "r", encoding="utf-8") as fh:
        src = fh.read()
    code = compile(src, TARGET, "exec")
    sys.settrace(_tracer)
    try:
        exec(code, g)
    finally:
        sys.settrace(None)
        _emit("done", {"steps": _steps, "emitted": _emitted})

_run()
`;

/* Convert a Python/GDB step report into a call-stack VFrame. */
function stackFrame(step: any, title: string): VFrame {
  const nodes: VNode[] = [];
  const edges: VEdge[] = [];
  const stack: any[] = Array.isArray(step.stack) ? step.stack : [];

  // Each call frame is a node in a vertical tower; the top of stack is active.
  // 4.0.0: the line to open when a node of this call frame is double-tapped.
  // Only trusted when positive, and (for gdb, which reports every frame up to
  // libc) only when the frame lives in the user's own file. The Python tracer
  // already filters to the user's file and sends no `file` field.
  const userBase = typeof step.userFile === 'string' ? step.userFile : undefined;
  const frameLine = (sf: any): number | undefined => {
    const ln = Number(sf && sf.line);
    if (!Number.isInteger(ln) || ln <= 0) return undefined;
    if (sf.file !== undefined && userBase !== undefined && sf.file !== userBase) return undefined;
    return ln;
  };

  stack.forEach((sf: any, depth: number) => {
    const isTop = depth === stack.length - 1;
    const frameId = 'f' + depth;
    const fl = frameLine(sf);          // shared by this frame and all its locals
    nodes.push({
      id: frameId,
      label: (sf.func || '?') + '  ·  line ' + (sf.line ?? '?'),
      state: isTop ? (step.event === 'return' ? 'done' : 'active') : 'visited',
      x: 0, y: (stack.length - 1 - depth) * 3, z: 0,
      group: 'stack',
      note: 'depth ' + depth,
      line: fl
    });
    if (depth > 0) {
      edges.push({ from: 'f' + (depth - 1), to: frameId, directed: true, state: 'visited' });
    }

    // Locals hang to the right of their frame, value shown in the label.
    const locals = sf.locals || {};
    const keys = Object.keys(locals);
    keys.forEach((k: string, i: number) => {
      const v = locals[k];
      // A list/array becomes its own little row of element nodes.
      if (Array.isArray(v)) {
        v.forEach((el: any, j: number) => {
          nodes.push({
            id: frameId + ':' + k + ':' + j,
            label: String(el),
            value: typeof el === 'number' ? el : undefined,
            state: isTop ? 'active' : 'normal',
            x: 4 + j * 1.4,
            y: (stack.length - 1 - depth) * 3 + 0.6,
            z: -1 - i * 1.2,
            group: 'array',
            note: k + '[' + j + ']',
            line: fl
          });
        });
        // label node for the array name
        nodes.push({
          id: frameId + ':' + k + ':name',
          label: k + '[]',
          state: isTop ? 'active' : 'normal',
          x: 3, y: (stack.length - 1 - depth) * 3 + 0.6, z: -1 - i * 1.2,
          group: 'varname',
          line: fl
        });
      } else {
        nodes.push({
          id: frameId + ':' + k,
          label: k + ' = ' + fmtVal(v),
          state: isTop ? 'active' : 'normal',
          x: 4, y: (stack.length - 1 - depth) * 3 - i * 0.9, z: 1,
          group: 'local',
          line: fl
        });
        edges.push({ from: frameId, to: frameId + ':' + k, directed: false, state: 'normal' });
      }
    });
  });

  const evLabel = step.event === 'call' ? 'called ' + (step.func || '')
    : step.event === 'return' ? 'returned ' + (step.ret !== null && step.ret !== undefined ? fmtVal(step.ret) : '')
    : 'line ' + (step.line ?? '');

  return {
    kind: 'graph',
    title,
    note: evLabel,
    nodes,
    edges,
    line: typeof step.line === 'number' ? step.line : undefined,
    layout: 'stack'
  };
}

function fmtVal(v: any): string {
  if (v === null || v === undefined) return 'None';
  if (typeof v === 'string') return '"' + v + '"';
  if (typeof v === 'object') return JSON.stringify(v).slice(0, 30);
  return String(v);
}

/* ── Python backend ────────────────────────────────────────────── */

function runPythonDebug(file: string, timeoutMs: number, emit: DebugEmit,
                        log: (s: string) => void): Promise<DebugResult> {
  return new Promise(resolve => {
    // Asli Python 3 (Windows par `py -3`; Store stub kabhi nahi) — interpreters.ts
    const found = resolvePython(pythonPathSetting());
    if (!found) {
      resolve({ ok: false, language: 'Python', tool: 'none', frames: 0, exitCode: null,
        summary: pythonInstallHint().text });
      return;
    }
    const py = found.cmd;
    const tracerPath = path.join(os.tmpdir(), 'vyuha_tracer_' + process.pid + '.py');
    fs.writeFileSync(tracerPath, PY_TRACER, 'utf8');

    const child = spawn(py, [...found.args, '-u', tracerPath, file], {
      cwd: path.dirname(file),
      env: { ...process.env, VYUHA_MAX_STEPS: '4000' }
    });

    let frames = 0;
    let acc = '';
    const title = 'debug · ' + path.basename(file);
    let done = false;

    const timer = setTimeout(() => {
      if (!done) { try { child.kill(); } catch { /* */ } }
    }, Math.max(timeoutMs, 15000));

    child.stdout.on('data', d => log(d.toString()));
    child.stderr.on('data', d => {
      acc += d.toString();
      let nl;
      while ((nl = acc.indexOf('\n')) !== -1) {
        const line = acc.slice(0, nl); acc = acc.slice(nl + 1);
        const tag = line.indexOf('##VYUHADBG##');
        if (tag === -1) { if (line.trim()) log(line); continue; }
        try {
          const msg = JSON.parse(line.slice(tag + 12));
          if (msg.__vyuha_dbg === 'step') { emit(stackFrame(msg, title)); frames++; }
        } catch { /* partial line at exit */ }
      }
    });

    child.on('exit', code => {
      done = true;
      clearTimeout(timer);
      try { fs.unlinkSync(tracerPath); } catch { /* */ }
      resolve({
        ok: true, language: 'Python', tool: py + ' (sys.settrace)',
        frames, exitCode: code,
        summary: frames + ' debugger steps traced with ' + py + ' — no print instrumentation needed.'
      });
    });
    child.on('error', err => {
      done = true;
      clearTimeout(timer);
      resolve({ ok: false, language: 'Python', tool: py, frames, exitCode: null,
        summary: 'Could not start the Python debugger: ' + err.message });
    });
  });
}

/* ── C / C++ backend (GDB batch) ───────────────────────────────── */

function runGdbDebug(file: string, isCpp: boolean, timeoutMs: number,
                     emit: DebugEmit, log: (s: string) => void): Promise<DebugResult> {
  return new Promise(resolve => {
    const gdb = which('gdb');
    const cc = isCpp ? (which('g++') ? 'g++' : which('clang++') ? 'clang++' : '')
                     : (which('gcc') ? 'gcc' : which('clang') ? 'clang' : '');
    if (!gdb || !cc) {
      resolve({ ok: false, language: isCpp ? 'C++' : 'C', tool: gdb ? cc : 'gdb',
        frames: 0, exitCode: null,
        summary: (!gdb ? 'gdb is not installed. ' : '') + (!cc ? 'No C/C++ compiler found.' : '') +
                 ' The C/C++ debugger needs both gdb and gcc/g++.' });
      return;
    }
    const work = fs.mkdtempSync(path.join(os.tmpdir(), 'vyuha-gdb-'));
    const bin = path.join(work, 'a.out');

    // Compile with debug info, no optimisation so lines map 1:1.
    execFile(cc, ['-g', '-O0', file, '-o', bin],
      { maxBuffer: 8 * 1024 * 1024 }, (err: any, _o: string, stderr: string) => {
        if (err) {
          resolve({ ok: false, language: isCpp ? 'C++' : 'C', tool: cc, frames: 0, exitCode: null,
            summary: 'Compilation for debugging failed:\n' + (stderr || String(err)).trim().slice(0, 400) });
          return;
        }
        driveGdb(gdb, bin, file, isCpp, work, timeoutMs, emit, log, resolve);
      });
  });
}

function driveGdb(gdb: string, bin: string, file: string, isCpp: boolean, work: string,
                  timeoutMs: number, emit: DebugEmit, log: (s: string) => void,
                  resolve: (r: DebugResult) => void) {
  // A GDB command script: break in main, then step, printing a machine-readable
  // marker with the current line, the backtrace, and the locals at each stop.
  const cmds = [
    'set pagination off',
    'set print pretty off',
    'set width 0',
    'set height 0',
    'break main',
    'run',
    // python-in-gdb loop: step through, emitting one JSON line per stop.
    'python',
    'import gdb, json, os',
    'MAX = 2000',
    'count = 0',
    'def locals_here():',
    '    out = {}',
    '    try:',
    '        frame = gdb.selected_frame()',
    '        block = frame.block()',
    '        seen = set()',
    '        while block:',
    '            for sym in block:',
    '                if sym.is_variable or sym.is_argument:',
    '                    if sym.name in seen: continue',
    '                    seen.add(sym.name)',
    '                    try:',
    '                        val = sym.value(frame)',
    '                        s = str(val)',
    '                        out[sym.name] = s[:40]',
    '                    except Exception:',
    '                        pass',
    '            if block.function: break',
    '            block = block.superblock',
    '    except Exception:',
    '        pass',
    '    return out',
    // Only report stops inside the user's own file. `step` descends into
    // libc, and a trace of glibc internals is thousands of frames of noise
    // that buries the program being studied.
    'USERFILE = ' + JSON.stringify(path.basename(file)),
    'def emit_stop():',
    '    global count',
    '    try:',
    '        frame = gdb.selected_frame()',
    '        sal = frame.find_sal()',
    '        line = sal.line',
    '        func = frame.name() or "?"',
    '        fname = sal.symtab.filename if sal and sal.symtab else ""',
    '    except Exception:',
    '        return False',
    '    if os.path.basename(fname) != USERFILE:',
    '        return True',
    '    stack = []',
    '    f = gdb.newest_frame()',
    '    chain = []',
    '    while f is not None:',
    '        chain.append(f)',
    '        f = f.older()',
    '    chain.reverse()',
    '    for fr in chain:',
    '        try:',
    '            fr.select()',
    '            sal = fr.find_sal()',
    '            stack.append({"func": fr.name() or "?", "line": sal.line if sal else 0, "file": os.path.basename(sal.symtab.filename) if sal and sal.symtab else "", "locals": locals_here()})',
    '        except Exception:',
    '            pass',
    '    chain[-1].select()',
    '    msg = {"__vyuha_dbg":"step","event":"line","line":line,"func":func,"stack":stack,"userFile":USERFILE}',
    '    gdb.write("##VYUHADBG##" + json.dumps(msg) + "\\n", gdb.STDERR)',
    '    gdb.flush()',
    '    return True',
    'while count < MAX:',
    '    if not emit_stop(): break',
    '    count += 1',
    '    try:',
    '        gdb.execute("step", to_string=True)',
    '    except gdb.error:',
    '        break',
    '    try:',
    '        gdb.selected_frame()',
    '    except gdb.error:',
    '        break',
    'gdb.write("##VYUHADBG##" + json.dumps({"__vyuha_dbg":"done","steps":count}) + "\\n", gdb.STDERR)',
    'gdb.flush()',
    'end',
    'quit'
  ].join('\n');

  const cmdFile = path.join(work, 'cmds.gdb');
  fs.writeFileSync(cmdFile, cmds, 'utf8');

  const child = spawn(gdb, ['--batch', '-x', cmdFile, bin], { cwd: path.dirname(file) });
  let frames = 0, acc = '', done = false;
  const title = 'debug · ' + path.basename(file);

  const timer = setTimeout(() => { if (!done) { try { child.kill(); } catch { /* */ } } },
    Math.max(timeoutMs, 20000));

  child.stdout.on('data', d => {
    // program stdout and gdb chatter are interleaved; only pass real output
    const t = d.toString();
    if (!t.includes('##VYUHADBG##')) log(t);
  });
  child.stderr.on('data', d => {
    acc += d.toString();
    let nl;
    while ((nl = acc.indexOf('\n')) !== -1) {
      const line = acc.slice(0, nl); acc = acc.slice(nl + 1);
      const tag = line.indexOf('##VYUHADBG##');
      if (tag === -1) continue;
      try {
        const msg = JSON.parse(line.slice(tag + 12));
        if (msg.__vyuha_dbg === 'step') { emit(stackFrame(msg, title)); frames++; }
      } catch { /* partial */ }
    }
  });
  child.on('exit', code => {
    done = true;
    clearTimeout(timer);
    try { fs.rmSync(work, { recursive: true, force: true }); } catch { /* */ }
    // frames === 0 means the gdb python block never emitted anything -- the
    // trace did not happen. Reporting ok:true there is worse than failing:
    // the view shows nothing and nothing says why.
    resolve({
      ok: frames > 0, language: isCpp ? 'C++' : 'C',
      tool: 'gdb + ' + (isCpp ? 'g++' : 'gcc'),
      frames, exitCode: code,
      summary: frames > 0
        ? frames + ' debugger steps traced with gdb — no print instrumentation needed.'
        : 'gdb produced no steps (exit ' + code + '). Check that gdb has Python support: '
          + 'gdb --batch -ex "python print(1)"'
    });
  });
  child.on('error', err => {
    done = true;
    clearTimeout(timer);
    resolve({ ok: false, language: isCpp ? 'C++' : 'C', tool: 'gdb', frames, exitCode: null,
      summary: 'Could not start gdb: ' + err.message });
  });
}

/* ── Java backend (jdb, 4.1.2) ─────────────────────────────────────
 * WHY: Debug Visualize covered Python and C/C++ only; Java students had to add
 *      print calls. jdb ships with every JDK, so no extra install is needed.
 * HOW (flow):
 *   1. javac -g compiles the program (and Vyuha.java if it sits beside it)
 *      into a temp folder, with full debug info so lines and locals exist.
 *   2. jdb is started on the main class and driven like a person would type:
 *      each command is sent only after jdb shows its prompt ("main[1] ").
 *   3. Per step: `where` gives the call stack, `locals` the top frame's
 *      variables, `dump` expands arrays. That becomes the SAME step message
 *      the Python tracer and gdb produce, so stackFrame() draws it unchanged.
 *   4. Frames outside the user's file (Vyuha.java, other classes) are left
 *      with `step up`; JDK classes are skipped by jdb's default exclude list.
 * LIMITS: locals are read for the top frame only (other frames show their
 *   line); at most MAX_STEPS steps; arrays are cut to 40 elements.
 */
const JAVA_MAX_STEPS = 600;

function runJavaDebug(file: string, timeoutMs: number, emit: DebugEmit,
                      log: (s: string) => void): Promise<DebugResult> {
  return new Promise(resolve => {
    const javac = which('javac');
    const jdb = which('jdb');
    if (!javac || !jdb) {
      resolve({ ok: false, language: 'Java', tool: 'none', frames: 0, exitCode: null,
        summary: 'Java Debug Visualize needs a JDK (javac + jdb). A JRE alone is not enough — install e.g. openjdk-21-jdk.' });
      return;
    }
    const work = fs.mkdtempSync(path.join(os.tmpdir(), 'vyuha-jdb-'));
    const dir = path.dirname(file);
    const helper = path.join(dir, 'Vyuha.java');
    const sources = [file];
    if (fs.existsSync(helper) && path.resolve(helper) !== path.resolve(file)) sources.push(helper);
    const cls = javaMainClassOf(file);
    const userBase = path.basename(file);

    execFile(javac, ['-g', '-d', work, ...sources], { maxBuffer: 8 * 1024 * 1024 },
      (err: any, _o: string, stderr: string) => {
        if (err) {
          try { fs.rmSync(work, { recursive: true, force: true }); } catch { /* */ }
          resolve({ ok: false, language: 'Java', tool: 'javac', frames: 0, exitCode: null,
            summary: 'Compilation for debugging failed:\n' + (stderr || String(err)).trim().slice(0, 400) });
          return;
        }
        driveJdb(jdb, work, cls, userBase, dir, timeoutMs, emit, log, resolve);
      });
  });
}

/** Class name incl. package ("algo.Sort"), read from the file head. */
function javaMainClassOf(file: string): string {
  const name = path.basename(file).replace(/\.java$/i, '');
  try {
    const head = fs.readFileSync(file, 'utf8').slice(0, 4000)
      .replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    const m = /^\s*package\s+([\w.]+)\s*;/m.exec(head);
    if (m) return m[1] + '.' + name;
  } catch { /* plain name */ }
  return name;
}

/** Turn one jdb value into something stackFrame can draw. */
function jdbValue(raw: string): any {
  const v = raw.trim();
  if (/^-?\d+(\.\d+)?([eE][-+]?\d+)?$/.test(v)) return Number(v);
  if (v === 'true' || v === 'false') return v === 'true';
  if (v === 'null') return null;
  const str = /^"(.*)"$/.exec(v);
  if (str) return str[1];
  const ch = /^'(.)'$/.exec(v);
  if (ch) return ch[1];
  // "instance of java.util.ArrayList(id=812)" -> "ArrayList"
  const inst = /^instance of ([\w$.]+)/.exec(v);
  if (inst) return inst[1].split('.').pop();
  return v;
}

function driveJdb(jdb: string, work: string, cls: string, userBase: string, cwd: string,
                  timeoutMs: number, emit: DebugEmit, log: (s: string) => void,
                  resolve: (r: DebugResult) => void) {
  const title = 'debug · ' + userBase;
  let frames = 0;
  let finished = false;
  let exited = false;
  let dbg: ReturnType<typeof spawn> | null = null;

  // Why two processes: if jdb launches the program itself, the program's output
  // comes out of jdb's own stdout, interleaved mid-line with jdb's prompts (seen
  // in testing: "main[1] 1],"title":..."), which breaks prompt detection. So the
  // program runs in its own JVM with the JDWP debug agent (suspended at start,
  // free port chosen by the OS) and jdb ATTACHES to it. Program output then
  // arrives cleanly on the java process's stdout and goes to the log.
  const java = which('java') || 'java';
  /*
   * Port PEHLE se chuno (address=…:0 nahi). Pehle hum JVM ke stdout par
   * "Listening for transport dt_socket at address: PORT" ka intezaar karte the —
   * Windows par pipe wala stdout buffer ho jaata hai, woh line kabhi nahi aati,
   * JVM suspend=y par ruka rehta aur Java Debug Visualize ek bhi step nahi deta.
   */
  const port = freePort();
  const vm = spawn(java, [
    '-agentlib:jdwp=transport=dt_socket,server=y,suspend=y,address=127.0.0.1:' + port,
    '-cp', work, cls
  ], { cwd });

  const finish = (code: number | null, note?: string) => {
    if (finished) return;
    finished = true;
    clearTimeout(timer);
    try { if (dbg && dbg.stdin) dbg.stdin.write('quit\n'); } catch { /* */ }
    setTimeout(() => {
      try { if (dbg) dbg.kill(); } catch { /* */ }
      try { vm.kill(); } catch { /* */ }
    }, 300);
    try { fs.rmSync(work, { recursive: true, force: true }); } catch { /* */ }
    resolve({
      ok: frames > 0, language: 'Java', tool: 'jdb + javac', frames, exitCode: code,
      summary: frames > 0
        ? frames + ' debugger steps traced with jdb — no print instrumentation needed.' + (note ? ' ' + note : '')
        : 'jdb produced no steps.' + (note ? ' ' + note : '')
    });
  };
  const timer = setTimeout(() => finish(null, 'Stopped at the time limit.'), Math.max(timeoutMs, 20000));
  vm.on('error', err => finish(null, 'Could not start java: ' + err.message));
  let vmExited = false;
  vm.on('exit', code => { vmExited = true; exited = true; if (waiterFlush) waiterFlush(); if (!dbg) finish(code); });

  let waiterFlush: (() => void) | null = null;
  let vmOut = '';
  let attached = false;
  vm.stdout!.on('data', d => {
    vmOut += d.toString();
    let nl;
    while ((nl = vmOut.indexOf('\n')) !== -1) {
      const line = vmOut.slice(0, nl).replace(/\r$/, ''); vmOut = vmOut.slice(nl + 1);
      const pm = /Listening for transport dt_socket at address: (?:[\d.]+:)?(\d+)/.exec(line);
      if (pm) { if (!attached) { attached = true; attach(String(port)); } continue; }
      if (line.trim()) log(line);                  // the program's own output
    }
  });
  vm.stderr!.on('data', d => log(d.toString().trimEnd()));
  if (process.env.VYUHA_DEBUG_JDB === '1') log('[vm] ' + java + ' port ' + port + ' cls ' + cls + ' work ' + work);
  // "Listening…" line na aaye (Windows) to bhi thodi der baad attach karo
  setTimeout(() => { if (!attached && !finished) { attached = true; attach(String(port)); } }, 1200);

  let attachTries = 0;
  function attach(port: string) {
    attachTries++;
    /*
     * `-attach host:port` Windows par shared-memory connector (dt_shmem) chunta hai
     * aur "127.0.0.1:PORT" ko shmem ka NAAM samajh leta hai — jdb chup-chaap band.
     * Socket connector ko naam se maango: Windows, Linux, macOS teeno par same.
     */
    const child = spawn(jdb, ['-connect', 'com.sun.jdi.SocketAttach:hostname=127.0.0.1,port=' + port], { cwd });
    dbg = child;
    let buf = '';
    let waiter: { until: RegExp; res: (text: string) => void } | null = null;

    // jdb answers some commands at once (where, locals, dump: text + prompt) and
    // others LATER (step, cont: a prompt right away, then "Step completed" /
    // "Breakpoint hit" and a second prompt). So every command waits for its own
    // "done" pattern, not just for the next prompt.
    const THREAD_PROMPT = /[\w$.-]+\[\d+\] $/;
    const EXITED = /The application exited|application exited/;
    const STEP_DONE = /(?:Step completed|Breakpoint hit)[^\n]*\n[\s\S]*[\w$.-]+\[\d+\] $/;

    const flush = () => {
      if (!waiter) return;
      if (waiter.until.test(buf) || EXITED.test(buf) || exited) {
        const text = buf; buf = '';
        const w = waiter; waiter = null;
        w.res(text);
      }
    };
    waiterFlush = flush;
    // Windows ka jdb har line "\r\n" se khatam karta hai; parse regexes ka `$`
    // us "\r" par fail hota tha aur Windows par ek bhi step nahi milta tha.
    const trace = process.env.VYUHA_DEBUG_JDB === '1';
    if (trace) log('[jdb] attach try ' + attachTries + ' → socket 127.0.0.1:' + port + ' using ' + jdb);
    child.stdout!.on('data', d => { if (trace) log('[jdb<] ' + JSON.stringify(d.toString()).slice(0, 300)); buf += d.toString().replace(/\r/g, ''); flush(); });
    child.stderr!.on('data', d => { if (trace) log('[jdb!] ' + JSON.stringify(d.toString()).slice(0, 300)); buf += d.toString().replace(/\r/g, ''); flush(); });
    let sawPrompt = false;
    child.stdout!.on('data', () => { if (THREAD_PROMPT.test(buf) || /> $/.test(buf)) sawPrompt = true; });
    child.on('exit', () => {
      // JVM abhi port par sun nahi raha tha ("Unable to attach") — thoda ruk kar dobara
      if (!sawPrompt && !finished && attachTries < 10 && !vmExited) { buf = ''; setTimeout(() => attach(port), 400); return; }
      exited = true; flush(); finish(0);
    });
    child.on('error', err => finish(null, 'Could not start jdb: ' + err.message));

    const ask = (cmd: string | null, until: RegExp = THREAD_PROMPT) => new Promise<string>(res => {
      waiter = { until, res };
      if (cmd !== null) { try { child.stdin!.write(cmd + '\n'); } catch { /* closed */ } }
      flush();
    });
    // jdb prints big line numbers with a thousands comma ("1,620").
    const num = (t: string) => Number(t.replace(/,/g, ''));

    (async () => {
      await ask(null);                                 // "VM Started ... main[1] "
      await ask('stop in ' + cls + '.main');
      let out = await ask('cont', STEP_DONE);          // "Breakpoint hit ... main[1] "

      for (let n = 0; n < JAVA_MAX_STEPS && !finished; n++) {
        if (EXITED.test(out) || exited) break;
        const where = await ask('where', /\[1\][^\n]*\n[\s\S]*[\w$.-]+\[\d+\] $/);
        // "  [1] Fact.fact (Fact.java:4)"  -- top of stack first
        const stack: any[] = [];
        const re = /\[(\d+)\] ([\w$.<>]+) \(([^:()]+):([\d,]+)\)/g;
        let m: RegExpExecArray | null;
        while ((m = re.exec(where)) !== null) {
          const fn = m[2].split('.').pop() || m[2];
          stack.push({ func: fn, line: num(m[4]), file: m[3], locals: {} });
        }
        // main has returned (only JDK frames left): let the program finish.
        if (!stack.some(f => f.file === userBase)) { out = await ask('cont', EXITED); break; }
        if (stack[0].file !== userBase) {
          // Inside the helper or another class: leave it and keep going.
          out = await ask('step up', STEP_DONE);
          continue;
        }

        // Locals of the top frame; arrays expanded with `dump`.
        const loc = await ask('locals', /(?:Method arguments|Local variables|No local variables)[\s\S]*[\w$.-]+\[\d+\] $/);
        const locals: Record<string, any> = {};
        for (const line of loc.split('\n')) {
          const lm = /^\s*([\w$]+) = (.*)$/.exec(line);
          if (!lm) continue;
          const name = lm[1]; const raw = lm[2].trim();
          if (/^instance of [\w$.]+\[\d+\]/.test(raw)) {
            const dump = await ask('dump ' + name, /=\s*\{[\s\S]*\}[\s\S]*[\w$.-]+\[\d+\] $/);
            const dm = /=\s*\{([\s\S]*?)\}/.exec(dump);
            locals[name] = dm ? dm[1].split(',').map(x => x.trim()).filter(x => x.length).slice(0, 40).map(jdbValue) : jdbValue(raw);
          } else {
            locals[name] = jdbValue(raw);
          }
        }
        stack[0].locals = locals;

        emit(stackFrame({
          __vyuha_dbg: 'step', event: 'line', line: stack[0].line, func: stack[0].func,
          stack: stack.slice().reverse(),              // stackFrame wants bottom -> top
          userFile: userBase
        }, title));
        frames++;

        out = await ask('step', STEP_DONE);
      }
      finish(0, frames >= JAVA_MAX_STEPS ? 'Stopped after ' + JAVA_MAX_STEPS + ' steps.' : undefined);
    })().catch(e => finish(null, String(e && e.message || e)));
  }
}

/* ── entry point ───────────────────────────────────────────────── */

export function debugVisualize(file: string, timeoutMs: number,
                               emit: DebugEmit, log: (s: string) => void): Promise<DebugResult> {
  const ext = path.extname(file).replace(/^\./, '').toLowerCase();
  if (ext === 'py' || ext === 'py3') return runPythonDebug(file, timeoutMs, emit, log);
  if (ext === 'c') return runGdbDebug(file, false, timeoutMs, emit, log);
  if (['cpp', 'cc', 'cxx', 'c++'].includes(ext)) return runGdbDebug(file, true, timeoutMs, emit, log);
  if (ext === 'java') return runJavaDebug(file, timeoutMs, emit, log);   // 4.1.2
  return Promise.resolve({
    ok: false, language: ext || 'unknown', tool: 'none', frames: 0, exitCode: null,
    summary: 'Debugger visualisation supports Python, C/C++ and Java so far. This file is .' + ext + '.'
  });
}
