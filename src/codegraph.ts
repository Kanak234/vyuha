/**
 * Automatic visualisation for programs that say nothing about themselves.
 *
 * The wire protocol in protocol.ts covers the case where a program *chooses*
 * to draw itself. Most programs do not. A plain "hello world" prints one line
 * and exits, and until now VYUHA had nothing to show for it.
 *
 * So this module reads the source file the way a reader does — top to bottom,
 * tracking nesting — and builds a picture of the program's shape: its
 * functions, its loops and branches, its printing statements, and who calls
 * whom. That picture is then joined to the toolchain stages (source, compile,
 * link, run, output) so a single graph shows both what the code IS and what
 * the machine is DOING to it right now.
 *
 * It is a structural read, not a compiler front end. It is deliberately
 * heuristic and deliberately never throws: a wrong guess costs a slightly odd
 * node in a picture, and that is a far better failure than refusing to draw.
 */

import * as path from 'path';
import { VEdge, VFrame, VNode, NodeState } from './protocol';

export type CodeKind = 'file' | 'func' | 'loop' | 'branch' | 'out' | 'read' | 'return' | 'class';

export interface CodeNode {
  id: string;
  label: string;
  kind: CodeKind;
  line: number;
  parent?: string;
}

export interface CodeGraph {
  file: string;
  language: string;
  nodes: CodeNode[];
  edges: { from: string; to: string; label?: string }[];
  /** Ids of printing statements, in source order — lit as output arrives. */
  outputs: string[];
  /** Where execution is assumed to begin. */
  entry: string;
  truncated: boolean;
}

/* ── language families ─────────────────────────────────────────── */

const FAMILY: Record<string, string> = {
  c: 'c', h: 'c', cpp: 'c', cc: 'c', cxx: 'c', hpp: 'c', m: 'c',
  java: 'java', kt: 'java', scala: 'java', cs: 'java', swift: 'java', dart: 'java',
  js: 'js', mjs: 'js', cjs: 'js', ts: 'js', mts: 'js', jsx: 'js', tsx: 'js', coffee: 'js',
  py: 'py', py3: 'py',
  go: 'go', rs: 'rust', rb: 'ruby', php: 'php', pl: 'perl', lua: 'lua',
  sh: 'shell', bash: 'shell', zsh: 'shell', fish: 'shell',
  r: 'r', jl: 'julia', hs: 'haskell', ex: 'elixir', exs: 'elixir'
};

export function languageOf(file: string): string {
  const ext = path.extname(file).replace(/^\./, '').toLowerCase();
  return FAMILY[ext] || ext || 'text';
}

/** Function or method definitions, per family. Group 1 is always the name. */
const FUNC_RE: Record<string, RegExp[]> = {
  c: [
    /^\s*(?:[A-Za-z_][\w:<>,*&\s]*?[\s*&])([A-Za-z_]\w*)\s*\([^;]*\)\s*(?:const\s*)?\{?\s*$/,
    /^\s*([A-Za-z_]\w*)\s*::\s*([A-Za-z_]\w*)\s*\([^;]*\)/
  ],
  java: [
    /^\s*(?:public|private|protected|static|final|abstract|synchronized|override|open|suspend|\s)*[A-Za-z_][\w<>\[\],.\s]*\s+([A-Za-z_]\w*)\s*\([^;]*\)\s*(?:throws [\w,.\s]+)?\{?\s*$/,
    /^\s*fun\s+([A-Za-z_]\w*)\s*\(/,
    /^\s*(?:func|def)\s+([A-Za-z_]\w*)\s*\(/
  ],
  js: [
    /^\s*(?:export\s+)?(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)\s*\(/,
    /^\s*(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:function|\()/,
    /^\s*(?:async\s+)?([A-Za-z_$][\w$]*)\s*\([^)]*\)\s*\{\s*$/
  ],
  py: [/^\s*(?:async\s+)?def\s+([A-Za-z_]\w*)\s*\(/],
  go: [/^\s*func\s+(?:\([^)]*\)\s*)?([A-Za-z_]\w*)\s*\(/],
  rust: [/^\s*(?:pub\s+)?(?:async\s+)?fn\s+([A-Za-z_]\w*)\s*[(<]/],
  ruby: [/^\s*def\s+([A-Za-z_]\w*[?!]?)/],
  php: [/^\s*(?:public|private|protected|static|\s)*function\s+([A-Za-z_]\w*)\s*\(/],
  perl: [/^\s*sub\s+([A-Za-z_]\w*)/],
  lua: [/^\s*(?:local\s+)?function\s+([A-Za-z_][\w.:]*)/],
  shell: [/^\s*(?:function\s+)?([A-Za-z_]\w*)\s*\(\s*\)\s*\{/],
  r: [/^\s*([A-Za-z_.][\w.]*)\s*(?:<-|=)\s*function\s*\(/],
  julia: [/^\s*function\s+([A-Za-z_]\w*)/],
  haskell: [/^([a-z_]\w*)\s*::/],
  elixir: [/^\s*def(?:p)?\s+([a-z_]\w*)/]
};

const CLASS_RE = /^\s*(?:public\s+|private\s+|export\s+|abstract\s+|final\s+|pub\s+)*(?:class|struct|interface|enum|trait|impl|record)\s+([A-Za-z_]\w*)/;

const LOOP_RE = /^\s*(?:\}\s*)?(?:for\s*[\s(]|foreach\s*\(|while\s*[\s(]|do\s*\{|loop\s*\{|repeat\b|until\b)/;
const BRANCH_RE = /^\s*(?:\}\s*)?(?:else\s+if|elif|else\b|if\s*[\s(]|switch\s*\(|match\s+|case\b|when\b|try\s*\{|catch\s*\()/;
const RETURN_RE = /^\s*(?:return|yield)\b/;

/** Statements that produce visible output — the ones a run actually lights up. */
const OUT_RE = /(\bstd\s*::\s*)?\bcout\b|\bcerr\b|\bprintf\s*\(|\bputs\s*\(|\bprint(?:ln|f|_r)?\s*[\s(!]|System\s*\.\s*out\s*\.\s*print|console\s*\.\s*(?:log|info|warn|error)\s*\(|\bfmt\s*\.\s*(?:Print|Println|Printf)\b|\becho\b|\bdisplay\s*\(|\bputStrLn\b|\bIO\.puts\b/;
const READ_RE = /\bcin\s*>>|\bscanf\s*\(|\bgets\s*\(|\bgetline\s*\(|\binput\s*\(|\breadline\s*\(|Scanner\s*\(|\bfmt\s*\.\s*Scan|\bread\s*\(|\bgetchar\s*\(/;

const MAX_NODES = 90;

/* ── the reader ────────────────────────────────────────────────── */

/**
 * Read a source file into a structure graph.
 * Never throws: on anything unexpected it falls back to a one-node graph so
 * the run still has something to show.
 */
export function analyzeSource(file: string, source: string): CodeGraph {
  const language = languageOf(file);
  const base = path.basename(file);
  const fileId = 'file';
  const nodes: CodeNode[] = [{ id: fileId, label: base, kind: 'file', line: 1 }];
  const edges: { from: string; to: string; label?: string }[] = [];
  const outputs: string[] = [];
  let truncated = false;

  try {
    const lines = source.split(/\r?\n/);
    const funcRes = FUNC_RE[language] || FUNC_RE.c;
    const indentBased = language === 'py' || language === 'ruby' || language === 'haskell' ||
      language === 'elixir' || language === 'r';

    /* Pass 1 — every function name we can see, so calls can be resolved. */
    const funcLine = new Map<string, number>();
    lines.forEach((raw, i) => {
      const line = strip(raw);
      if (!line) return;
      for (const re of funcRes) {
        const m = re.exec(line);
        if (m) {
          const name = m[2] || m[1];
          if (name && !KEYWORDS.has(name) && !funcLine.has(name)) funcLine.set(name, i + 1);
          break;
        }
      }
    });

    /* Pass 2 — walk the file keeping a stack of open scopes. */
    const stack: { id: string; depth: number }[] = [{ id: fileId, depth: -1 }];
    let depth = 0;
    let currentFn = fileId;

    for (let i = 0; i < lines.length; i++) {
      const raw = lines[i];
      const line = strip(raw);
      const lineNo = i + 1;
      if (!line) { if (!indentBased) depth += braceDelta(raw); continue; }

      const indent = indentBased ? leadingSpaces(raw) : depth;

      // Close scopes we have left.
      while (stack.length > 1 && indent <= stack[stack.length - 1].depth) stack.pop();
      const parent = stack[stack.length - 1].id;

      let made: CodeNode | undefined;

      const cls = CLASS_RE.exec(line);
      const fn = matchAny(funcRes, line);

      if (fn && !KEYWORDS.has(fn)) {
        const id = 'fn:' + fn;
        if (!nodes.some(n => n.id === id)) {
          made = { id, label: fn + '()', kind: 'func', line: lineNo, parent: fileId };
        }
        currentFn = id;
        stack.push({ id, depth: indent });
      } else if (cls) {
        const id = 'cls:' + cls[1];
        if (!nodes.some(n => n.id === id)) {
          made = { id, label: cls[1], kind: 'class', line: lineNo, parent: fileId };
        }
        stack.push({ id, depth: indent });
      } else if (LOOP_RE.test(line)) {
        const id = 'l:' + lineNo;
        made = { id, label: firstWord(line) + ' · ' + lineNo, kind: 'loop', line: lineNo, parent };
        stack.push({ id, depth: indent });
      } else if (BRANCH_RE.test(line)) {
        const id = 'b:' + lineNo;
        made = { id, label: firstWord(line) + ' · ' + lineNo, kind: 'branch', line: lineNo, parent };
        stack.push({ id, depth: indent });
      } else if (OUT_RE.test(line)) {
        const id = 'o:' + lineNo;
        made = { id, label: 'print · ' + lineNo, kind: 'out', line: lineNo, parent };
        outputs.push(id);
      } else if (READ_RE.test(line)) {
        made = { id: 'r:' + lineNo, label: 'input · ' + lineNo, kind: 'read', line: lineNo, parent };
      } else if (RETURN_RE.test(line) && currentFn !== fileId) {
        made = { id: 'rt:' + lineNo, label: 'return · ' + lineNo, kind: 'return', line: lineNo, parent };
      }

      if (made && nodes.length < MAX_NODES) {
        nodes.push(made);
        if (made.parent) edges.push({ from: made.parent, to: made.id });
      } else if (made) {
        truncated = true;
        if (made.kind === 'out') outputs.pop();
      }

      // Calls out of this line, to functions defined in this same file.
      if (nodes.length < MAX_NODES) {
        for (const name of callsIn(line)) {
          const target = 'fn:' + name;
          if (!funcLine.has(name)) continue;
          if (target === currentFn) continue;
          if (!nodes.some(n => n.id === target)) {
            nodes.push({ id: target, label: name + '()', kind: 'func', line: funcLine.get(name)!, parent: fileId });
          }
          const from = currentFn;
          if (!edges.some(e => e.from === from && e.to === target)) {
            edges.push({ from, to: target, label: 'calls' });
          }
        }
      }

      if (!indentBased) depth += braceDelta(raw);
    }
  } catch {
    /* A malformed file should still draw. */
  }

  const entry = pickEntry(nodes, fileId);
  return { file, language, nodes, edges, outputs, entry, truncated };
}

const KEYWORDS = new Set([
  'if', 'for', 'while', 'switch', 'catch', 'return', 'sizeof', 'do', 'else',
  'and', 'or', 'not', 'in', 'is', 'new', 'delete', 'throw', 'main_'
]);

const CALL_SKIP = new Set([
  ...KEYWORDS,
  'printf', 'scanf', 'cout', 'cin', 'print', 'println', 'log', 'push_back',
  'length', 'size', 'append', 'range', 'len', 'str', 'int', 'float', 'malloc'
]);

function callsIn(line: string): string[] {
  const out: string[] = [];
  const re = /\b([A-Za-z_]\w*)\s*\(/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(line))) {
    if (!CALL_SKIP.has(m[1])) out.push(m[1]);
  }
  return out;
}

function matchAny(res: RegExp[], line: string): string | undefined {
  for (const re of res) {
    const m = re.exec(line);
    if (m) return m[2] || m[1];
  }
  return undefined;
}

/** Comments and string bodies removed, so keywords inside them do not count. */
function strip(raw: string): string {
  let s = raw.replace(/"(?:\\.|[^"\\])*"/g, '""').replace(/'(?:\\.|[^'\\])*'/g, "''");
  const c = s.indexOf('//');
  if (c >= 0) s = s.slice(0, c);
  const h = s.search(/(^|\s)#(?!include|vyuha)/);
  if (h >= 0 && /\.(py|rb|sh|pl|r)$/.test('') === false) {
    // '#' starts a comment in several languages; keep C preprocessor lines.
    if (!/^\s*#\s*(include|define|pragma|ifndef|ifdef|endif|if|else)/.test(s)) s = s.slice(0, h);
  }
  return s.trim();
}

function braceDelta(raw: string): number {
  const s = strip(raw);
  let d = 0;
  for (const ch of s) { if (ch === '{') d++; else if (ch === '}') d--; }
  return d;
}

function leadingSpaces(raw: string): number {
  const m = /^[ \t]*/.exec(raw);
  return m ? m[0].replace(/\t/g, '    ').length : 0;
}

function firstWord(line: string): string {
  const m = /[A-Za-z_]\w*/.exec(line);
  return m ? m[0] : 'block';
}

function pickEntry(nodes: CodeNode[], fileId: string): string {
  const named = ['main', 'Main', 'run', 'start'];
  for (const n of named) {
    const hit = nodes.find(x => x.id === 'fn:' + n);
    if (hit) return hit.id;
  }
  const firstFn = nodes.find(x => x.kind === 'func');
  return firstFn ? firstFn.id : fileId;
}

/* ── toolchain stages ──────────────────────────────────────────── */

export interface Stage { id: string; label: string; }

/*
 * A word boundary is no help here: `c++` ends in a non-word character, so
 * /\bc\+\+\b/ never matches. Anchor on whitespace instead.
 */
const COMPILERS = /(^|\s)(cc|gcc|g\+\+|c\+\+|clang\+\+|clang|rustc|javac|kotlinc|go\s+build|tsc|gfortran|nim\s+c|zig\s+build|crystal\s+build|swiftc|dmd|ldc2|mcs|fpc)(\s|$)/;

/**
 * The stages this command will move through.
 * A compile-then-run command line ("c++ x.cpp -o bin && bin") gets a compile
 * stage; an interpreter gets only source → run → output.
 */
export function stagesFor(command: string, language: string): Stage[] {
  const stages: Stage[] = [{ id: 's:src', label: 'source' }];
  const parts = command.split(/&&|;/);
  const compiles = parts.some(p => COMPILERS.test(p));
  if (compiles) {
    stages.push({ id: 's:compile', label: 'compile' });
    stages.push({ id: 's:link', label: 'link' });
  } else if (language === 'py' || language === 'js' || language === 'ruby' || language === 'php') {
    stages.push({ id: 's:parse', label: 'parse · bytecode' });
  }
  stages.push({ id: 's:run', label: 'run' });
  stages.push({ id: 's:out', label: 'output' });
  return stages;
}

/* ── frames ────────────────────────────────────────────────────── */

export interface AutoState {
  stages: Record<string, NodeState>;
  code: Record<string, NodeState>;
  outCount: number;
  note?: string;
  title?: string;
  line?: number;
}

/**
 * One combined picture: the toolchain across the top, the program's own shape
 * hanging off the run stage. Keeping both in a single node set means the
 * layout stays still while states change, which is what makes the animation
 * readable instead of jumpy.
 */
export function autoFrame(cg: CodeGraph, stages: Stage[], st: AutoState): VFrame {
  const nodes: VNode[] = [];
  const edges: VEdge[] = [];

  stages.forEach((s, i) => {
    const state = st.stages[s.id] || 'normal';
    nodes.push({
      id: s.id,
      label: s.label,
      state,
      note: 'toolchain stage',
      group: 'stage',
      value: s.id === 's:out' ? st.outCount : undefined
    });
    if (i > 0) {
      edges.push({ from: stages[i - 1].id, to: s.id, state: state === 'normal' ? 'normal' : 'done', directed: true });
    }
  });

  const runStage = stages.find(s => s.id === 's:run');
  for (const n of cg.nodes) {
    nodes.push({
      id: n.id,
      label: n.label,
      state: st.code[n.id] || 'normal',
      note: n.kind + ' · line ' + n.line,
      group: n.kind
    });
  }
  for (const e of cg.edges) {
    edges.push({
      from: e.from, to: e.to, label: e.label,
      state: (st.code[e.to] && st.code[e.to] !== 'normal') ? 'active' : 'normal',
      directed: true
    });
  }
  if (runStage) {
    edges.push({ from: runStage.id, to: cg.entry, state: st.code[cg.entry] ? 'active' : 'normal', directed: true, label: 'enters' });
  }

  return {
    kind: 'graph',
    title: st.title || path.basename(cg.file),
    note: st.note,
    nodes,
    edges,
    line: st.line
  };
}

/** A fresh state with everything untouched. */
export function initialState(): AutoState {
  return { stages: {}, code: {}, outCount: 0 };
}
