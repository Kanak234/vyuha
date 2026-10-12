/*
 * interpreters.ts — kis command se Python / C / C++ chalana hai, yeh machine
 * par JAANCH kar batata hai.
 *
 * WHY (Rahul ke laptop wala bug):
 *   VYUHA hamesha `python3` likhta tha. Windows par:
 *     - `python3` aksar hota hi nahi (python.org installer `python` aur `py` deta hai)
 *     - Python install na ho to `python`/`python3` Microsoft Store ka NAKLI stub hota
 *       hai jo "Python was not found; run without arguments to install from the
 *       Microsoft Store..." chhap kar band ho jaata hai
 *   Isliye Windows par program chala hi nahi. Same tarah `cc` / `c++` Windows (MinGW)
 *   par nahi hote — wahan `gcc` / `g++` hote hain.
 * WHAT: har candidate ko `--version` se chala kar dekhta hai ki woh ASLI Python 3 hai.
 *   Store stub "Python 3.x" nahi chhapta, isliye apne aap reject ho jaata hai.
 * ORDER (Python):
 *   1. setting `vyuha.pythonPath`
 *   2. MS Python extension ka chuna hua interpreter (`python.defaultInterpreterPath`)
 *   3. Windows: `py -3` (official launcher) → `python` → `python3`
 *      baaki:    `python3` → `python`
 * FLOW: runner.ts / debugviz.ts / compilerviz.ts → resolvePython() → {cmd, args, display}
 */
import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

export interface Interpreter {
  /** executable (naam ya poora path) */
  cmd: string;
  /** cmd ke baad hamesha lagne wale args, jaise `py -3` mein ['-3'] */
  args: string[];
  /** shell command line ke liye quoted form, jaise `py -3` ya `"C:\\Py\\python.exe"` */
  display: string;
  /** "Python 3.12.4" */
  version: string;
}

const cache = new Map<string, Interpreter | null>();

/** Settings badlein to cache saaf karo (extension.ts onDidChangeConfiguration se) */
export function clearInterpreterCache() { cache.clear(); }

function quoteIfNeeded(p: string): string {
  return /\s/.test(p) && !/^".*"$/.test(p) ? '"' + p + '"' : p;
}

/** "py -3" → { cmd:'py', args:['-3'] };  'C:\\Program Files\\Python\\python.exe' → poora path */
function split(candidate: string): { cmd: string; args: string[] } {
  const c = candidate.trim().replace(/^"(.*)"$/, '$1');
  if (fs.existsSync(c)) return { cmd: c, args: [] };          // path mein spaces ho sakte hain
  const parts = c.split(/\s+/);
  return { cmd: parts[0], args: parts.slice(1) };
}

/** Candidate chala kar dekho — sirf asli Python 3 ko accept karo */
export function probePython(candidate: string): Interpreter | null {
  const { cmd, args } = split(candidate);
  if (!cmd) return null;
  try {
    const r = spawnSync(cmd, [...args, '--version'], { encoding: 'utf8', timeout: 10000, windowsHide: true });
    if (r.error || r.status !== 0) return null;
    const text = (r.stdout || '') + (r.stderr || '');
    const m = /Python (3\.\d+(?:\.\d+)?)/.exec(text);
    if (!m) return null;                                      // Store stub / Python 2 → reject
    return { cmd, args, display: [quoteIfNeeded(cmd), ...args].join(' '), version: 'Python ' + m[1] };
  } catch { return null; }
}

/**
 * @param preferred  vyuha.pythonPath setting
 * @param fromPythonExt  python.defaultInterpreterPath (MS Python extension)
 */
export function resolvePython(preferred?: string, fromPythonExt?: string): Interpreter | null {
  const key = 'py|' + (preferred || '') + '|' + (fromPythonExt || '');
  if (cache.has(key)) return cache.get(key) || null;
  const win = process.platform === 'win32';
  const cands: string[] = [];
  if (preferred && preferred.trim()) cands.push(preferred);
  // MS Python extension ka default value bas "python" hota hai — woh kuch nahi batata
  if (fromPythonExt && fromPythonExt.trim() && fromPythonExt.trim() !== 'python') cands.push(fromPythonExt);
  cands.push(...(win ? ['py -3', 'python', 'python3'] : ['python3', 'python']));
  let found: Interpreter | null = null;
  for (const c of cands) { found = probePython(c); if (found) break; }
  cache.set(key, found);
  return found;
}

/** C / C++ compiler jo is machine par sach mein chalta hai */
export function resolveCCompiler(cpp: boolean): string | null {
  const key = 'cc|' + cpp;
  if (cache.has(key)) { const v = cache.get(key); return v ? v.cmd : null; }
  const win = process.platform === 'win32';
  const cands = cpp
    ? (win ? ['g++', 'clang++', 'c++'] : ['c++', 'g++', 'clang++'])
    : (win ? ['gcc', 'clang', 'cc'] : ['cc', 'gcc', 'clang']);
  for (const c of cands) {
    try {
      const r = spawnSync(c, ['--version'], { encoding: 'utf8', timeout: 10000, windowsHide: true });
      if (!r.error && r.status === 0) {
        cache.set(key, { cmd: c, args: [], display: c, version: (r.stdout || '').split(/\r?\n/)[0] });
        return c;
      }
    } catch { /* next */ }
  }
  cache.set(key, null);
  return null;
}

/** User ko Python install karne ka sabse seedha tareeka (message mein dikhaane ke liye) */
export function pythonInstallHint(): { text: string; url: string; command?: string } {
  if (process.platform === 'win32') {
    return {
      text: 'Python 3 is not installed (the "python" on this PC is only the Microsoft Store shortcut). Install it, then restart VS Code.',
      url: 'https://www.python.org/downloads/windows/',
      command: 'winget install -e --id Python.Python.3.12 --scope user --accept-package-agreements --accept-source-agreements'
    };
  }
  if (process.platform === 'darwin') return { text: 'Python 3 was not found.', url: 'https://www.python.org/downloads/macos/', command: 'xcode-select --install' };
  return { text: 'Python 3 was not found.', url: 'https://www.python.org/downloads/', command: 'sudo apt-get install -y python3' };
}

export const _test = { split, quoteIfNeeded, path };
