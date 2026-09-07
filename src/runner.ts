import { spawn, ChildProcess } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { parseLine, Payload, VFrame } from './protocol';

/**
 * Built-in run commands, keyed by file extension.
 *
 * Placeholders:
 *   ${file}                absolute path of the source file
 *   ${dir}                 folder holding the file
 *   ${fileBasename}        name.ext
 *   ${fileBasenameNoExt}   name
 *   ${bin}                 a temp path for compiled output
 *
 * Anything missing can be added by the user through the `vyuha.runners`
 * setting, which is merged over this table. That is what makes "every
 * language" true rather than aspirational: the table is a starting point,
 * not a closed list.
 */
export const RUNNERS: Record<string, string> = {
  py: 'python3 -u "${file}"',
  py3: 'python3 -u "${file}"',
  js: 'node "${file}"',
  mjs: 'node "${file}"',
  cjs: 'node "${file}"',
  ts: 'npx --yes tsx "${file}"',
  mts: 'npx --yes tsx "${file}"',
  java: 'java "${file}"',
  kt: 'kotlinc "${file}" -include-runtime -d "${bin}.jar" && java -jar "${bin}.jar"',
  c: 'cc "${file}" -O2 -o "${bin}" -lm && "${bin}"',
  cpp: 'c++ -std=c++17 -O2 "${file}" -o "${bin}" && "${bin}"',
  cc: 'c++ -std=c++17 -O2 "${file}" -o "${bin}" && "${bin}"',
  cxx: 'c++ -std=c++17 -O2 "${file}" -o "${bin}" && "${bin}"',
  m: 'cc "${file}" -o "${bin}" -framework Foundation && "${bin}"',
  go: 'go run "${file}"',
  rs: 'rustc -O "${file}" -o "${bin}" && "${bin}"',
  rb: 'ruby "${file}"',
  php: 'php "${file}"',
  pl: 'perl "${file}"',
  lua: 'lua "${file}"',
  sh: 'bash "${file}"',
  bash: 'bash "${file}"',
  zsh: 'zsh "${file}"',
  fish: 'fish "${file}"',
  ps1: 'pwsh -NoProfile -File "${file}"',
  bat: 'cmd /c "${file}"',
  cmd: 'cmd /c "${file}"',
  r: 'Rscript "${file}"',
  jl: 'julia "${file}"',
  swift: 'swift "${file}"',
  dart: 'dart run "${file}"',
  scala: 'scala "${file}"',
  groovy: 'groovy "${file}"',
  clj: 'clojure -M "${file}"',
  hs: 'runghc "${file}"',
  ex: 'elixir "${file}"',
  exs: 'elixir "${file}"',
  erl: 'escript "${file}"',
  nim: 'nim r --hints:off "${file}"',
  zig: 'zig run "${file}"',
  cr: 'crystal run "${file}"',
  d: 'rdmd "${file}"',
  v: 'v run "${file}"',
  f90: 'gfortran "${file}" -o "${bin}" && "${bin}"',
  f95: 'gfortran "${file}" -o "${bin}" && "${bin}"',
  cs: 'dotnet script "${file}"',
  fsx: 'dotnet fsi "${file}"',
  vb: 'dotnet script "${file}"',
  coffee: 'npx --yes coffee "${file}"',
  tcl: 'tclsh "${file}"',
  awk: 'awk -f "${file}"',
  sql: 'sqlite3 < "${file}"'
};

export interface RunFrames {
  frames: VFrame[];
  netSpec?: unknown;
}

export interface RunHooks {
  onOutput(text: string): void;
  onFrame(payload: Payload, index: number): void;
  onWarning(message: string): void;
  onExit(code: number | null, signal: string | null, elapsedMs: number): void;
}

/** One program execution. Owns its child process and cleans up after itself. */
export class RunSession {
  private child: ChildProcess | undefined;
  private killTimer: NodeJS.Timeout | undefined;
  private stdoutTail = '';
  private stderrTail = '';
  private frameCount = 0;
  private startedAt = 0;
  private finished = false;

  readonly file: string;
  readonly command: string;

  constructor(
    file: string,
    command: string,
    private readonly cwd: string,
    private readonly maxFrames: number,
    private readonly timeoutSec: number,
    private readonly hooks: RunHooks,
    private readonly stdinFile?: string
  ) {
    this.file = file;
    this.command = command;
  }

  get running(): boolean { return !!this.child && !this.finished; }

  start() {
    this.startedAt = Date.now();
    const shell = process.platform === 'win32' ? true : '/bin/bash';
    /*
     * stdin matters more than it looks. Left as an open pipe nobody writes to,
     * a program that reads input (cin, input(), Scanner) waits forever and the
     * run just appears to do nothing. So: feed it a file if one is there, and
     * otherwise close stdin immediately so the read fails fast and the program
     * ends instead of hanging.
     */
    let stdin: any = 'ignore';
    let inputText: string | undefined;
    if (this.stdinFile) {
      try {
        inputText = fs.readFileSync(this.stdinFile, 'utf8');
        stdin = 'pipe';
      } catch {
        this.hooks.onWarning('Could not read the input file ' + this.stdinFile + '.');
      }
    }

    this.child = spawn(this.command, {
      cwd: this.cwd,
      shell: shell as any,
      detached: process.platform !== 'win32',
      stdio: [stdin, 'pipe', 'pipe'],
      env: { ...process.env, VYUHA: '1', PYTHONUNBUFFERED: '1' }
    });

    if (inputText !== undefined && this.child.stdin) {
      this.child.stdin.on('error', () => { /* the program may not read at all */ });
      this.child.stdin.end(inputText);
      this.hooks.onOutput('[vyuha] fed ' + inputText.split(/\r?\n/).length + ' lines from ' +
        path.basename(this.stdinFile as string) + '\n\n');
    }

    this.child.stdout?.setEncoding('utf8');
    this.child.stderr?.setEncoding('utf8');
    this.child.stdout?.on('data', (c: string) => { this.stdoutTail = this.consume(this.stdoutTail + c, false); });
    this.child.stderr?.on('data', (c: string) => { this.stderrTail = this.consume(this.stderrTail + c, true); });

    this.child.on('error', err => {
      this.hooks.onOutput('\n[vyuha] could not start: ' + err.message + '\n');
      this.done(null, null);
    });
    this.child.on('close', (code, signal) => {
      // Flush whatever did not end in a newline.
      if (this.stdoutTail) { this.consume(this.stdoutTail + '\n', false); this.stdoutTail = ''; }
      if (this.stderrTail) { this.consume(this.stderrTail + '\n', true); this.stderrTail = ''; }
      this.done(code, signal);
    });

    if (this.timeoutSec > 0) {
      this.killTimer = setTimeout(() => {
        this.hooks.onWarning('The program ran longer than ' + this.timeoutSec + 's and was stopped.');
        this.stop();
      }, this.timeoutSec * 1000);
    }
  }

  stop() {
    if (!this.child || this.finished) return;
    try {
      if (process.platform === 'win32') spawn('taskkill', ['/pid', String(this.child.pid), '/f', '/t']);
      else process.kill(-this.child.pid!, 'SIGKILL');
    } catch {
      try { this.child.kill('SIGKILL'); } catch { /* already gone */ }
    }
  }

  /** Split a chunk into whole lines; keep the remainder for the next chunk. */
  private consume(buf: string, isErr: boolean): string {
    const parts = buf.split(/\r?\n/);
    const rest = parts.pop() ?? '';
    for (const line of parts) {
      const res = parseLine(line);
      if (res === null) {
        this.hooks.onOutput((isErr ? '! ' : '') + line + '\n');
        continue;
      }
      if ('error' in res) {
        this.hooks.onWarning(res.error);
        continue;
      }
      if (this.frameCount >= this.maxFrames) {
        if (this.frameCount === this.maxFrames) {
          this.hooks.onWarning('Stopped collecting after ' + this.maxFrames + ' frames. Raise vyuha.maxFrames if you need more.');
          this.frameCount++;
        }
        continue;
      }
      this.hooks.onFrame(res.payload, this.frameCount);
      this.frameCount++;
    }
    return rest;
  }

  private done(code: number | null, signal: string | null) {
    if (this.finished) return;
    this.finished = true;
    if (this.killTimer) clearTimeout(this.killTimer);
    this.hooks.onExit(code, signal, Date.now() - this.startedAt);
  }
}

/** The command that would run this file, or null when the extension is unknown. */
export function commandFor(file: string, overrides: Record<string, string>): string | null {
  const ext = path.extname(file).replace(/^\./, '').toLowerCase();
  if (overrides && overrides[ext]) {
    return expand(overrides[ext], file);
  }
  const template = RUNNERS[ext];
  if (!template) return null;

  if (ext === 'go') {
    const dir = path.dirname(file);
    const helper = path.join(dir, 'vyuha.go');
    if (fs.existsSync(helper) && path.resolve(file) !== path.resolve(helper)) {
      return `go run "${file}" "${helper}"`;
    }
  }

  return expand(template, file);
}

export function knownExtensions(overrides: Record<string, string>): string[] {
  return [...new Set([...Object.keys(RUNNERS), ...Object.keys(overrides || {})])].sort();
}

export function expand(template: string, file: string): string {
  const dir = path.dirname(file);
  const base = path.basename(file);
  const noExt = base.replace(/\.[^.]+$/, '');
  const bin = path.join(os.tmpdir(), 'vyuha-' + noExt.replace(/[^\w.-]/g, '_') + '-' + process.pid);
  return template
    .replace(/\$\{file\}/g, file)
    .replace(/\$\{dir\}/g, dir)
    .replace(/\$\{fileBasenameNoExt\}/g, noExt)
    .replace(/\$\{fileBasename\}/g, base)
    .replace(/\$\{bin\}/g, bin);
}

/**
 * The input a program should be fed, if any.
 * Looks for `<name>.stdin`, then `<name>.in`, then `input.txt` beside the file.
 */
export function stdinFileFor(file: string, explicit?: string): string | undefined {
  if (explicit) {
    const p = path.isAbsolute(explicit) ? explicit : path.join(path.dirname(file), explicit);
    return fs.existsSync(p) ? p : undefined;
  }
  const dir = path.dirname(file);
  const noExt = path.basename(file).replace(/\.[^.]+$/, '');
  const candidates = [
    path.join(dir, noExt + '.stdin'),
    path.join(dir, noExt + '.in'),
    path.join(dir, 'input.txt')
  ];
  for (const c of candidates) {
    try { if (fs.statSync(c).isFile()) return c; } catch { /* not there */ }
  }
  return undefined;
}

/* ══ running inside VS Code's integrated terminal ═══════════════ */

/**
 * Why a terminal at all.
 *
 * A child process with a piped stdout is the tidy way to read a program's
 * output, and it is the wrong way to run a program a person is watching. Piped
 * stdout is block buffered, so prompts appear late or not at all, and a
 * program that reads input has nobody to read from. Code Runner users expect a
 * terminal, and a terminal is what a program that calls cin actually needs.
 *
 * So the program runs in the real terminal, and a copy of the session is
 * written to a log file that the extension tails. On Unix that copy comes from
 * `script`, which hands the program a pty — line buffered, interactive, exactly
 * as if it were run by hand.
 */

export const EXIT_SENTINEL = '@@VYUHA_EXIT';

const ANSI = /[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g;

/** Terminal logs carry cursor moves and colour codes; frames do not want them. */
export function stripAnsi(s: string): string {
  return s.replace(ANSI, '').replace(/\r(?!\n)/g, '');
}

export interface TerminalPlan {
  /** The single line to send to the terminal. */
  send: string;
  /** Where the session transcript will appear. */
  logPath: string;
  /** Scratch files to remove when the run is over. */
  cleanup: string[];
}

/**
 * Build the terminal command for one run.
 * The program itself is put in a small script so the terminal only ever sees
 * one short line, whatever the run command contains.
 */
export function planTerminalRun(command: string, cwd: string, stdinFile?: string): TerminalPlan {
  const id = 'vyuha-' + process.pid + '-' + Date.now().toString(36);
  const dir = os.tmpdir();
  const logPath = path.join(dir, id + '.log');
  const win = process.platform === 'win32';
  const redirect = stdinFile ? ' < ' + q(stdinFile, win) : '';

  if (win) {
    const script = path.join(dir, id + '.cmd');
    fs.writeFileSync(script,
      '@echo off\r\n' +
      'cd /d ' + q(cwd, true) + '\r\n' +
      'call ' + command + redirect + '\r\n' +
      'echo ' + EXIT_SENTINEL + ' %ERRORLEVEL%\r\n', 'utf8');
    return {
      send: 'cmd /c ' + q(script, true) + ' 2>&1 | Tee-Object -FilePath ' + q(logPath, true),
      logPath,
      cleanup: [script, logPath]
    };
  }

  const script = path.join(dir, id + '.sh');
  fs.writeFileSync(script,
    '#!/bin/sh\n' +
    'cd ' + q(cwd, false) + ' || exit 1\n' +
    /*
     * The command runs in a subshell so that a program (or a script) calling
     * exit cannot take the wrapper down with it and swallow the exit code.
     */
    '( ' + command + ' )' + redirect + '\n' +
    '__vc=$?\n' +
    'printf "\\n' + EXIT_SENTINEL + ' %s\\n" "$__vc"\n', 'utf8');
  try { fs.chmodSync(script, 0o755); } catch { /* not fatal */ }

  const runner = 'sh ' + q(script, false);
  let send: string;
  if (hasScriptCommand()) {
    // A pty keeps the program line buffered and its prompts interactive.
    send = process.platform === 'darwin'
      ? 'script -q ' + q(logPath, false) + ' ' + runner
      : 'script -q -e -c ' + shq(runner) + ' ' + q(logPath, false);
  } else {
    send = runner + ' 2>&1 | tee ' + q(logPath, false);
  }
  return { send, logPath, cleanup: [script, logPath] };
}

function hasScriptCommand(): boolean {
  for (const p of ['/usr/bin/script', '/bin/script', '/usr/local/bin/script']) {
    try { if (fs.statSync(p).isFile()) return true; } catch { /* keep looking */ }
  }
  return false;
}

function q(p: string, win: boolean): string {
  return win ? '"' + p + '"' : "'" + p.replace(/'/g, "'\\''") + "'";
}

/** Single-quote a whole command so a shell passes it along untouched. */
function shq(s: string): string {
  return "'" + s.replace(/'/g, "'\\''") + "'";
}

/**
 * Follow a growing log file line by line.
 * Polling beats fs.watch here: watch misses appends on some filesystems and
 * fires twice on others, and at this size a stat every eighth of a second
 * costs nothing.
 */
export class LogTail {
  private pos = 0;
  private buf = '';
  private timer: NodeJS.Timeout | undefined;
  private stopped = false;

  constructor(
    private readonly file: string,
    private readonly onLine: (line: string) => void,
    private readonly onExit: (code: number | null) => void,
    private readonly intervalMs = 120
  ) {}

  start() {
    this.timer = setInterval(() => this.poll(), this.intervalMs);
  }

  stop() {
    this.stopped = true;
    if (this.timer) { clearInterval(this.timer); this.timer = undefined; }
  }

  /** Read to the end once more, then stop. Used when a run is cut short. */
  finish() {
    this.poll();
    if (this.buf.trim()) { this.onLine(stripAnsi(this.buf)); this.buf = ''; }
    this.stop();
  }

  private poll() {
    if (this.stopped) return;
    let size: number;
    try { size = fs.statSync(this.file).size; } catch { return; }
    if (size < this.pos) { this.pos = 0; this.buf = ''; }
    if (size === this.pos) return;

    let chunk = '';
    try {
      const fd = fs.openSync(this.file, 'r');
      const len = size - this.pos;
      const b = Buffer.alloc(len);
      fs.readSync(fd, b, 0, len, this.pos);
      fs.closeSync(fd);
      chunk = b.toString('utf8');
      this.pos = size;
    } catch { return; }

    this.buf += chunk;
    const parts = this.buf.split(/\r?\n/);
    this.buf = parts.pop() ?? '';
    for (const raw of parts) {
      const line = stripAnsi(raw);
      const m = new RegExp('^' + EXIT_SENTINEL + '\\s+(-?\\d+)').exec(line.trim());
      if (m) {
        this.stop();
        this.onExit(parseInt(m[1], 10));
        return;
      }
      this.onLine(line);
    }
  }
}
