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
  stack.forEach((sf: any, depth: number) => {
    const isTop = depth === stack.length - 1;
    const frameId = 'f' + depth;
    nodes.push({
      id: frameId,
      label: (sf.func || '?') + '  ·  line ' + (sf.line ?? '?'),
      state: isTop ? (step.event === 'return' ? 'done' : 'active') : 'visited',
      x: 0, y: (stack.length - 1 - depth) * 3, z: 0,
      group: 'stack',
      note: 'depth ' + depth
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
            note: k + '[' + j + ']'
          });
        });
        // label node for the array name
        nodes.push({
          id: frameId + ':' + k + ':name',
          label: k + '[]',
          state: isTop ? 'active' : 'normal',
          x: 3, y: (stack.length - 1 - depth) * 3 + 0.6, z: -1 - i * 1.2,
          group: 'varname'
        });
      } else {
        nodes.push({
          id: frameId + ':' + k,
          label: k + ' = ' + fmtVal(v),
          state: isTop ? 'active' : 'normal',
          x: 4, y: (stack.length - 1 - depth) * 3 - i * 0.9, z: 1,
          group: 'local'
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
    const py = which('python3') ? 'python3' : (which('python') ? 'python' : '');
    if (!py) {
      resolve({ ok: false, language: 'Python', tool: 'none', frames: 0, exitCode: null,
        summary: 'No Python interpreter found. Install Python 3.' });
      return;
    }
    const tracerPath = path.join(os.tmpdir(), 'vyuha_tracer_' + process.pid + '.py');
    fs.writeFileSync(tracerPath, PY_TRACER, 'utf8');

    const child = spawn(py, ['-u', tracerPath, file], {
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
    '            stack.append({"func": fr.name() or "?", "line": sal.line if sal else 0, "locals": locals_here()})',
    '        except Exception:',
    '            pass',
    '    chain[-1].select()',
    '    msg = {"__vyuha_dbg":"step","event":"line","line":line,"func":func,"stack":stack}',
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

/* ── entry point ───────────────────────────────────────────────── */

export function debugVisualize(file: string, timeoutMs: number,
                               emit: DebugEmit, log: (s: string) => void): Promise<DebugResult> {
  const ext = path.extname(file).replace(/^\./, '').toLowerCase();
  if (ext === 'py' || ext === 'py3') return runPythonDebug(file, timeoutMs, emit, log);
  if (ext === 'c') return runGdbDebug(file, false, timeoutMs, emit, log);
  if (['cpp', 'cc', 'cxx', 'c++'].includes(ext)) return runGdbDebug(file, true, timeoutMs, emit, log);
  return Promise.resolve({
    ok: false, language: ext || 'unknown', tool: 'none', frames: 0, exitCode: null,
    summary: 'Debugger visualisation supports Python and C/C++ so far. This file is .' + ext + '.'
  });
}
