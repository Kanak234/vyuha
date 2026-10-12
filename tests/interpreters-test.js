/*
 * tests/interpreters-test.js — Rahul ke laptop wala bug ("Python was not found;
 * run without arguments to install from the Microsoft Store") ko reproduce karke
 * fix ko prove karta hai. Har OS par chalta hai: nakli Store-stub `python` /
 * `python3` banate hain jo bilkul wahi message de kar fail hote hain.
 */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

let failures = 0;
const ok = (label, cond, detail) => { console.log((cond ? 'OK   ' : 'FAIL ') + label + (detail !== undefined ? '  ' + detail : '')); if (!cond) failures++; };
const win = process.platform === 'win32';

// Real Python (test machine par) — fixture ke liye
function realPython() {
  for (const c of win ? [['py', ['-3']], ['python', []]] : [['python3', []], ['python', []]]) {
    const r = spawnSync(c[0], [...c[1], '-c', 'import sys;print(sys.executable)'], { encoding: 'utf8' });
    if (r.status === 0) return r.stdout.trim();
  }
  return null;
}
const real = realPython();

// Nakli Store stub: wahi message, exit 9009 (Windows) — PATH mein sabse aage
const stubDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vyuha-stub-'));
const STUB_MSG = 'Python was not found; run without arguments to install from the Microsoft Store, or disable this shortcut from Settings > Apps > Advanced app settings > App execution aliases.';
function makeStub(name) {
  if (win) fs.writeFileSync(path.join(stubDir, name + '.cmd'), '@echo ' + STUB_MSG + ' 1>&2\r\n@exit /b 9009\r\n');
  else { const f = path.join(stubDir, name); fs.writeFileSync(f, '#!/bin/sh\necho "' + STUB_MSG + '" >&2\nexit 9009\n'); fs.chmodSync(f, 0o755); }
}
makeStub('python'); makeStub('python3');

function fresh() {
  for (const k of Object.keys(require.cache)) if (/[\\/]out[\\/](interpreters|runner|protocol)\.js$/.test(k)) delete require.cache[k];
  return { I: require(__dirname + '/../out/interpreters.js'), R: require(__dirname + '/../out/runner.js') };
}

const savedPath = process.env.PATH;
console.log('— interpreter resolution (' + process.platform + ') —');

// 1) Stub-only PATH → Python "missing", koi stub kabhi accept nahi hota
process.env.PATH = stubDir + path.delimiter + (win ? '' : '/usr/bin:/bin');
{
  const { I, R } = fresh();
  const stubbed = I.probePython('python');
  ok('the Microsoft Store stub is rejected (prints "Python was not found")', stubbed === null);
  if (!win && fs.existsSync('/usr/bin/python3')) {
    // Linux par /usr/bin/python3 asli hai — isliye sirf stub wala PATH test karo
    process.env.PATH = stubDir;
  }
  I.clearInterpreterCache();
  const missing = R.toolCheck('/tmp/x.py', {});
  ok('with only the stub on PATH, VYUHA reports "Python missing" instead of running it', missing && missing.missing === 'python', JSON.stringify(missing));
  ok('the old hard-coded command would have hit the stub', R.RUNNERS.py.startsWith('python3'));
}

// 2) Setting `vyuha.pythonPath` → wahi use hota hai, stub ke bawajood
if (real) {
  process.env.PATH = stubDir;
  const { I, R } = fresh();
  R.setInterpreterSettings(real, '');
  const cmd = R.commandFor(path.join(os.tmpdir(), 'hello.py'), {});
  ok('vyuha.pythonPath wins over the stub', cmd && cmd.includes(real.includes(' ') ? '"' + real + '"' : real) && /-u "/.test(cmd), cmd);
  const fileOk = path.join(os.tmpdir(), 'vyuha_hello_' + process.pid + '.py');
  fs.writeFileSync(fileOk, 'print("namaste from python")\n');
  const r = spawnSync(R.commandFor(fileOk, {}), { shell: true, encoding: 'utf8' });
  ok('that command really runs a Python program', r.status === 0 && /namaste from python/.test(r.stdout), (r.stderr || '').slice(0, 120));
  fs.unlinkSync(fileOk);
  void I;
} else console.log('SKIP no real Python on this machine');

// 3) Windows order: `py -3` launcher pehle — nakli `py` jo "Python 3.12.4" deta hai
{
  const pyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vyuha-py-'));
  if (win) fs.writeFileSync(path.join(pyDir, 'py.cmd'), '@echo Python 3.12.4\r\n');
  else { fs.writeFileSync(path.join(pyDir, 'py'), '#!/bin/sh\necho "Python 3.12.4"\n'); fs.chmodSync(path.join(pyDir, 'py'), 0o755); }
  process.env.PATH = stubDir + path.delimiter + pyDir;
  const realPlatform = Object.getOwnPropertyDescriptor(process, 'platform');
  if (!win) Object.defineProperty(process, 'platform', { value: 'win32' });   // Windows logic simulate
  const { I } = fresh();
  // Native Windows: spawnSync .cmd files nahi chalata, isliye wahan asli `py` launcher
  // (GitHub windows-latest par installed) se check karo.
  if (win) process.env.PATH = savedPath;
  const found = win ? I.probePython('py -3') : (function () { I.clearInterpreterCache(); return I.resolvePython('', ''); })();
  if (!win) Object.defineProperty(process, 'platform', realPlatform);
  ok('on Windows the official `py -3` launcher is tried first', found && found.display === 'py -3' && (win ? /^Python 3/ : /3\.12/).test(found.version), JSON.stringify(found));
}

// 4) MS Python extension ka default "python" kuch nahi batata — ignore
{
  process.env.PATH = savedPath;
  const { I } = fresh();
  I.clearInterpreterCache();
  const a = I.resolvePython('', 'python');
  ok('python.defaultInterpreterPath = "python" (the default) is not treated as a choice', !a || a.cmd !== 'python' || !win);
}

// 5) C compiler: Windows par `cc` nahi — gcc chuna jaata hai
{
  process.env.PATH = savedPath;
  const { I, R } = fresh();
  const cc = I.resolveCCompiler(false);
  const cmd = R.commandFor(path.join(os.tmpdir(), 'a.c'), {});
  ok('C runner uses a compiler that exists on this machine (' + cc + ')', cc && cmd.startsWith(cc + ' '), cmd);
  ok('compiled binary gets .exe on Windows', !win || /\.exe"/.test(cmd));
}

process.env.PATH = savedPath;
fs.rmSync(stubDir, { recursive: true, force: true });
if (failures) { console.log('\nINTERPRETER TEST FAILED: ' + failures); process.exit(1); }
console.log('\nINTERPRETER TEST PASSED');

/* ── LogTail: Windows PowerShell 5.1 Tee-Object writes UTF-16LE ── */
(async () => {
  const { LogTail, EXIT_SENTINEL } = require(__dirname + '/../out/runner.js');
  for (const [label, enc, bom] of [['UTF-16LE with BOM (PowerShell 5.1)', 'utf16le', Buffer.from([0xff, 0xfe])], ['UTF-8', 'utf8', Buffer.alloc(0)]]) {
    const f = path.join(os.tmpdir(), 'vyuha-tail-' + enc + '-' + process.pid + '.log');
    fs.writeFileSync(f, bom);
    const lines = []; let exit = null;
    const t = new LogTail(f, l => lines.push(l), c => { exit = c; }, 20);
    t.start();
    const text = 'नमस्ते line one\r\nline two\r\n' + EXIT_SENTINEL + ' 3\r\n';
    const bytes = Buffer.from(text, enc);
    // byte-by-byte likho — toote hue characters ka worst case
    for (let i = 0; i < bytes.length; i += 3) { fs.appendFileSync(f, bytes.subarray(i, i + 3)); await new Promise(r => setTimeout(r, 2)); }
    await new Promise(r => setTimeout(r, 200));
    t.stop(); fs.unlinkSync(f);
    ok('LogTail reads ' + label + ' and sees the exit code', exit === 3 && lines[0] === 'नमस्ते line one' && lines[1] === 'line two', JSON.stringify({ exit, lines }));
  }
  if (failures) { console.log('\nLOGTAIL TEST FAILED'); process.exit(1); }
  console.log('LOGTAIL TEST PASSED');
})();
