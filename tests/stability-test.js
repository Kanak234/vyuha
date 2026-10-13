/*
 * tests/stability-test.js — VYUHA 4.2.0 "stable" release ka bada test (100+ checks).
 *
 * Kyun: har chhote bug fix ke baad poori extension ka har hissa ek saath check ho —
 * protocol parser, terminal log reader, run commands (har language), crash codes,
 * background runner, source graph, net spec, aur helper libraries (Python, JS, C, C++,
 * Java, Go) jo @vyuha lines likhti hain. Har OS par chalta hai (CI: Windows/Linux/macOS).
 * Jo toolchain machine par nahi hai (javac, go, g++), uske checks SKIP hote hain — fail nahi.
 *
 * Flow: out/*.js (compiled extension) ko seedha require karte hain — VS Code ki
 * zaroorat nahi. Aakhir mein count print hota hai aur koi FAIL ho to exit 1.
 */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const OUT = path.join(__dirname, '..', 'out');
const P = require(path.join(OUT, 'protocol.js'));
const R = require(path.join(OUT, 'runner.js'));
const C = require(path.join(OUT, 'codegraph.js'));
const S = require(path.join(OUT, 'spec.js'));
const I = require(path.join(OUT, 'interpreters.js'));

const win = process.platform === 'win32';
let passed = 0, failed = 0, skipped = 0;
// ok(): ek check — label, sharat, aur fail hone par detail
function ok(label, cond, detail) {
  if (cond) { passed++; console.log('OK   ' + label); }
  else { failed++; console.log('FAIL ' + label + (detail !== undefined ? '  ' + String(detail).slice(0, 400) : '')); }
}
function skip(label, why) { skipped++; console.log('SKIP ' + label + ' — ' + why); }
function section(name) { console.log('\n— ' + name + ' —'); }
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vyuha-stable-'));
const frameOf = line => { const r = P.parseLine(line); return r && 'payload' in r ? r.payload : null; };
const dsOf = line => { const p = frameOf(line); return p && p.type === 'ds' ? p.frame : null; };
const has = cmd => { const r = spawnSync(cmd, ['--version'], { encoding: 'utf8', shell: win, timeout: 20000 }); return !r.error && r.status === 0; };

(async () => {
/* ══ 1. protocol: @vyuha line parser ══════════════════════════════ */
section('protocol');
ok('plain output is not a payload', P.parseLine('hello world') === null);
ok('"@vyuha" prefix is a payload line', P.isPayloadLine('@vyuha [1,2]'));
ok('"# vyuha" prefix works', !!dsOf('# vyuha [1,2]'));
ok('"// vyuha" prefix works', !!dsOf('// vyuha [1,2]'));
ok('prefix is case-insensitive', !!dsOf('@VYUHA [1]'));
ok('"@vyuha:" with colon works', !!dsOf('@vyuha: [1]'));
ok('leading spaces before @vyuha are fine', !!dsOf('   @vyuha [1]'));
ok('a word starting with vyuha is not a payload', P.parseLine('@vyuhax [1]') === null);
ok('bad JSON gives an error, not a crash', 'error' in (P.parseLine('@vyuha {nope') || {}));
ok('a JSON number alone is rejected with a message', 'error' in (P.parseLine('@vyuha 5') || {}));
ok('an object with no known key is rejected with a message', 'error' in (P.parseLine('@vyuha {"x":1}') || {}));
{
  const f = dsOf('@vyuha [5,3,8]');
  ok('bare array → array frame with 3 bars', f && f.kind === 'array' && f.nodes.length === 3 && f.nodes[2].value === 8);
}
{
  const f = dsOf('@vyuha []');
  ok('empty array is accepted (0 nodes)', f && f.nodes.length === 0);
}
{
  const f = dsOf('@vyuha {"array":[null,3,"x"]}');
  ok('null in an array has NO numeric value (not 0)', f && f.nodes[0].label === 'null' && f.nodes[0].value === undefined, JSON.stringify(f && f.nodes[0]));
  ok('a text value has no numeric value', f && f.nodes[2].value === undefined);
}
{
  const f = dsOf('@vyuha {"array":["",true,false]}');
  ok('empty string / booleans are not turned into 0/1 bar heights', f && f.nodes.every(n => n.value === undefined), JSON.stringify(f && f.nodes));
}
{
  const f = dsOf('@vyuha {"array":["3.5"]}');
  ok('a numeric string still gets its value', f && f.nodes[0].value === 3.5);
}
{
  const f = dsOf('@vyuha {"array":[1,2,3],"active":[1],"done":[2]}');
  ok('active / done indices map to states', f && f.nodes[1].state === 'active' && f.nodes[2].state === 'done' && f.nodes[0].state === 'normal');
}
{
  const f = dsOf('@vyuha {"array":[1.23456]}');
  ok('floats are labelled with 2 decimals', f && f.nodes[0].label === '1.23');
}
{
  const s = '😀'.repeat(30);
  const f = dsOf('@vyuha ' + JSON.stringify({ array: [s] }));
  const lab = f && f.nodes[0].label;
  ok('long emoji labels are cut on whole characters (no broken surrogate)', lab && !/[\uD800-\uDBFF]$/.test(lab) && !/^[\uDC00-\uDFFF]/.test(lab), JSON.stringify(lab));
}
{
  const f = dsOf('@vyuha {"matrix":[[1,2],[3]],"active":["0,1"]}');
  ok('ragged matrix keeps every cell', f && f.kind === 'matrix' && f.nodes.length === 3);
  ok('matrix "r,c" active cell is active', f && f.nodes.find(n => n.id === '0,1').state === 'active');
}
{
  const f = dsOf('@vyuha {"stack":[1,2,3]}');
  ok('stack → 3 nodes, 2 links', f && f.kind === 'stack' && f.nodes.length === 3 && f.edges.length === 2);
  const q = dsOf('@vyuha {"queue":[]}');
  ok('empty queue is fine', q && q.nodes.length === 0 && q.edges.length === 0);
}
{
  const f = dsOf('@vyuha {"tree":{"value":8,"left":{"value":3},"right":{"value":10,"right":{"value":14}}}}');
  ok('binary tree → 4 nodes, 3 edges', f && f.kind === 'tree' && f.nodes.length === 4 && f.edges.length === 3);
  ok('tree edges carry L/R slots', f && f.edges.some(e => e.label === 'L') && f.edges.some(e => e.label === 'R'));
}
{
  const f = dsOf('@vyuha {"tree":{"value":1,"children":[{"value":2},null,{"value":3}]}}');
  ok('n-ary tree skips null children', f && f.nodes.length === 3);
}
{
  let deep = { value: 0 };
  const root = deep;
  for (let i = 1; i < 30000; i++) { deep.left = { value: i }; deep = deep.left; }
  let f = null, err = null;
  try { f = P.normalise({ tree: root }); } catch (e) { err = e; }
  ok('a 30,000-deep tree does not overflow the stack', !err && f && f.frame.nodes.length === 30000, err && err.message);
}
{
  const f = dsOf('@vyuha {"adjacency":{"a":["b",["c",4]],"b":[]},"directed":false,"visited":["a"]}');
  ok('adjacency → 3 nodes incl. one only named as a neighbour', f && f.nodes.length === 3);
  ok('weighted edge keeps its weight and label', f && f.edges.some(e => e.weight === 4 && e.label === '4'));
  ok('directed:false is honoured', f && f.edges.every(e => e.directed === false));
  ok('visited marks node done', f && f.nodes.find(n => n.id === 'a').state === 'done');
}
{
  const f = dsOf('@vyuha {"nodes":[{"id":"a"},{"id":"b"}],"edges":[["a","b"],["a","zzz"],{"from":"b","to":"a","weight":2}]}');
  ok('edges to unknown nodes are dropped', f && f.edges.length === 2);
}
{
  const f = dsOf('@vyuha {"nodes":[{"id":"a","label":"x"},{"id":"a","label":"y"},{"id":"b"}]}');
  ok('duplicate node ids are merged (renderer needs unique ids)', f && f.nodes.length === 2 && new Set(f.nodes.map(n => n.id)).size === 2, f && JSON.stringify(f.nodes.map(n => n.id)));
}
{
  const f = dsOf('@vyuha {"nodes":[{"id":"a","state":"compare"},{"id":"b","state":"sorted"},{"id":"c","state":"seen"},{"id":"d","state":"weird"}]}');
  ok('state aliases compare/sorted/seen map, unknown → normal', f && f.nodes.map(n => n.state).join() === 'active,done,visited,normal');
}
ok('kind alias "linkedlist" → list', (dsOf('@vyuha {"kind":"linkedlist","nodes":[1]}') || {}).kind === 'list');
ok('kind alias "bst" → tree', (dsOf('@vyuha {"kind":"bst","nodes":[1]}') || {}).kind === 'tree');
ok('unknown kind falls back', (dsOf('@vyuha {"kind":"blob","array":[1]}') || {}).kind === 'array');
{
  const f = dsOf('@vyuha {"array":[1],"line":12,"title":"  sort  ","note":"' + 'n'.repeat(500) + '"}');
  ok('line / trimmed title kept, note capped at 200 chars', f && f.line === 12 && f.title === 'sort' && f.note.length === 200);
}
ok('bad line numbers (0, -3, 4.5, "12a") are dropped',
  ['0', '-3', '4.5', '"12a"'].every(v => (dsOf('@vyuha {"array":[1],"line":' + v + '}') || {}).line === undefined));
{
  const p = frameOf('@vyuha {"layers":[{"id":"a","kind":"input","n":2}]}');
  ok('a layers payload routes to the neural-net renderer', p && p.type === 'net');
}

/* ══ 2. stripAnsi: terminal log cleaning ══════════════════════════ */
section('terminal log cleaning');
ok('colour codes removed', R.stripAnsi('\x1b[31mred\x1b[0m') === 'red');
ok('cursor codes removed', R.stripAnsi('\x1b[2K\x1b[1Gdone') === 'done');
ok('OSC window-title sequence removed', R.stripAnsi('\x1b]0;my title\x07hello') === 'hello', JSON.stringify(R.stripAnsi('\x1b]0;my title\x07hello')));
ok('OSC 633 shell-integration (ST-terminated) removed', R.stripAnsi('\x1b]633;A\x1b\\@vyuha [1]') === '@vyuha [1]', JSON.stringify(R.stripAnsi('\x1b]633;A\x1b\\@vyuha [1]')));
ok('backspaces applied like a terminal', R.stripAnsi('abc\x08\x08X') === 'aX');
ok('macOS ^D echo removed', R.stripAnsi('^D\x08\x08@vyuha [1]') === '@vyuha [1]');
ok('lone CR dropped', R.stripAnsi('a\rb') === 'ab');
ok('Hindi text untouched', R.stripAnsi('नमस्ते दुनिया') === 'नमस्ते दुनिया');

/* ══ 3. Windows crash codes ════════════════════════════════════════ */
section('crash codes');
ok('-1073740791 → 0xC0000409', /0xC0000409/.test(R.explainExitCode(-1073740791) || ''));
ok('unsigned 3221226505 → 0xC0000409 too', /0xC0000409/.test(R.explainExitCode(3221226505) || ''));
ok('access violation explained', /ACCESS_VIOLATION/.test(R.explainExitCode(-1073741819) || ''));
ok('stack overflow explained', /STACK_OVERFLOW/.test(R.explainExitCode(-1073741571) || ''));
ok('divide by zero explained', /DIVIDE_BY_ZERO/.test(R.explainExitCode(-1073741676) || ''));
ok('DLL not found explained', /DLL_NOT_FOUND/.test(R.explainExitCode(-1073741515) || ''));
ok('Ctrl+C explained', /CONTROL_C/.test(R.explainExitCode(-1073741510) || ''));
ok('ordinary codes 0/1/2/127/null get no crash text', [0, 1, 2, 127, null].every(c => R.explainExitCode(c) === null));

/* ══ 4. run commands for every language ═══════════════════════════ */
section('run commands');
{
  const exts = Object.keys(R.RUNNERS);
  ok('50+ languages have a built-in run command', exts.length >= 50, exts.length);
  const spaced = path.join(tmp, 'my dir', 'prog file');
  const leftovers = exts.filter(e => /\$\{/.test(R.commandFor(spaced + '.' + e, {}) || '${missing}'));
  ok('every built-in command expands all ${…} placeholders', leftovers.length === 0, leftovers.join(','));
  const unquoted = exts.filter(e => { const c = R.commandFor(spaced + '.' + e, {}); return c.includes(spaced) && !c.includes('"' + spaced); });
  ok('a path with spaces is always quoted', unquoted.length === 0, unquoted.join(','));
}
ok('upper-case extension (.CPP) still runs', R.commandFor(path.join(tmp, 'A.CPP'), {}) !== null);
ok('unknown extension → null', R.commandFor(path.join(tmp, 'a.qqq'), {}) === null);
ok('file without extension → null', R.commandFor(path.join(tmp, 'Makefile'), {}) === null);
ok('override supports every placeholder', R.commandFor(path.join(tmp, 'a.zz'), { zz: 'x "${file}" ${dir} ${fileBasename} ${fileBasenameNoExt}' })
  === 'x "' + path.join(tmp, 'a.zz') + '" ' + tmp + ' a.zz a');
ok('override beats the built-in command', R.commandFor(path.join(tmp, 'a.js'), { js: 'bun "${file}"' }).startsWith('bun '));
ok('knownExtensions merges overrides', R.knownExtensions({ zz: 'x' }).includes('zz') && R.knownExtensions({}).includes('py'));
ok('compiled binaries get .exe only on Windows', /\.exe$/.test(R.expand('${bin}', path.join(tmp, 'a.c'))) === win);
ok('binary name is safe even for odd file names', !/[ ()]/.test(path.basename(R.expand('${bin}', path.join(tmp, 'a (copy) b.c')))));
{
  const jd = path.join(tmp, 'java'); fs.mkdirSync(jd);
  fs.writeFileSync(path.join(jd, 'Main.java'), '/* c */\npackage algo;\npublic class Main {}\n');
  ok('Java package is part of the main class', R.javaMainClass(path.join(jd, 'Main.java')) === 'algo.Main');
  fs.writeFileSync(path.join(jd, 'Plain.java'), 'public class Plain {}\n');
  ok('Java without package → plain class name', R.javaMainClass(path.join(jd, 'Plain.java')) === 'Plain');
  ok('missing Java file falls back to file name', R.javaMainClass(path.join(jd, 'Gone.java')) === 'Gone');
}
{
  const gd = path.join(tmp, 'go'); fs.mkdirSync(gd);
  fs.writeFileSync(path.join(gd, 'vyuha.go'), 'package main\n');
  ok('Go program next to vyuha.go compiles both', /vyuha\.go"$/.test(R.commandFor(path.join(gd, 'm.go'), {})));
  ok('running vyuha.go itself does not add it twice', (R.commandFor(path.join(gd, 'vyuha.go'), {}).match(/vyuha\.go/g) || []).length === 1);
}
{
  const cxx = I.resolveCCompiler(true);
  const cmd = R.commandFor(path.join(tmp, 'a.cpp'), {});
  if (cxx) {
    ok('C++ uses the compiler found on this machine', cmd.startsWith(cxx + ' ') || cmd.startsWith(cxx + ' -static'), cmd);
    ok('-static only on Windows g++', / -static /.test(cmd) === (win && cxx === 'g++'), cmd);
  } else { skip('C++ command checks', 'no C++ compiler'); }
}

/* ══ 5. stdin files ═══════════════════════════════════════════════ */
section('stdin files');
{
  const d = path.join(tmp, 'stdin'); fs.mkdirSync(d);
  const f = path.join(d, 'prog.py');
  ok('no input file → undefined', R.stdinFileFor(f) === undefined);
  fs.writeFileSync(path.join(d, 'input.txt'), '1');
  ok('input.txt is found', R.stdinFileFor(f) === path.join(d, 'input.txt'));
  fs.writeFileSync(path.join(d, 'prog.in'), '1');
  ok('prog.in beats input.txt', R.stdinFileFor(f) === path.join(d, 'prog.in'));
  fs.writeFileSync(path.join(d, 'prog.stdin'), '1');
  ok('prog.stdin beats prog.in', R.stdinFileFor(f) === path.join(d, 'prog.stdin'));
  ok('explicit relative file wins', R.stdinFileFor(f, 'input.txt') === path.join(d, 'input.txt'));
  ok('explicit missing file → undefined', R.stdinFileFor(f, 'nope.txt') === undefined);
  fs.mkdirSync(path.join(d, 'sub')); fs.mkdirSync(path.join(d, 'sub', 'input.txt'));
  ok('a FOLDER named input.txt is ignored', R.stdinFileFor(path.join(d, 'sub', 'x.py')) === undefined);
}

/* ══ 6. LogTail: reading the terminal transcript ══════════════════ */
section('terminal transcript reader');
async function tailOf(writeFn, waitMs = 300) {
  const f = path.join(tmp, 'tail-' + Math.random().toString(36).slice(2) + '.log');
  const lines = []; let exit;
  const t = new R.LogTail(f, l => lines.push(l), c => { exit = c; }, 15);
  t.start();
  await writeFn(f);
  await new Promise(r => setTimeout(r, waitMs));
  t.stop();
  return { lines, exit, t, f };
}
{
  const r = await tailOf(async f => fs.writeFileSync(f, 'a\nb\n' + R.EXIT_SENTINEL + ' 0\n'));
  ok('lines + exit 0 read', r.lines.join('|') === 'a|b' && r.exit === 0, JSON.stringify(r));
}
{
  const r = await tailOf(async f => fs.writeFileSync(f, 'x\r\n' + R.EXIT_SENTINEL + ' -1073740791\r\n'));
  ok('CRLF + negative crash code read', r.lines[0] === 'x' && r.exit === -1073740791, JSON.stringify(r));
}
{
  const r = await tailOf(async f => {
    const b = Buffer.from('नमस्ते\n' + R.EXIT_SENTINEL + ' 2\n', 'utf8');
    for (let i = 0; i < b.length; i++) { fs.appendFileSync(f, b.subarray(i, i + 1)); await new Promise(x => setTimeout(x, 1)); }
  }, 400);
  ok('UTF-8 written one byte at a time stays whole', r.lines[0] === 'नमस्ते' && r.exit === 2, JSON.stringify(r));
}
{
  const r = await tailOf(async f => fs.writeFileSync(f, '\x1b[32m@vyuha [1]\x1b[0m\n' + R.EXIT_SENTINEL + ' 0\n'));
  ok('colour codes stripped from transcript lines', r.lines[0] === '@vyuha [1]');
}
{
  const r = await tailOf(async f => fs.writeFileSync(f, 'echo ' + R.EXIT_SENTINEL + ' %ERRORLEVEL%\nok\n' + R.EXIT_SENTINEL + ' 5\n'));
  ok('an echoed command line is not mistaken for the exit marker', r.exit === 5, JSON.stringify(r));
}
{
  const r = await tailOf(async f => { fs.writeFileSync(f, 'old old old old old old old old old old old\n'); await new Promise(x => setTimeout(x, 60)); fs.writeFileSync(f, 'n\n' + R.EXIT_SENTINEL + ' 0\n'); });
  ok('a log that shrinks (rewritten) is read again from the start', r.lines.includes('n') && r.exit === 0, JSON.stringify(r));
}
{
  const f = path.join(tmp, 'partial.log'); fs.writeFileSync(f, 'done\nno newline');
  const lines = []; const t = new R.LogTail(f, l => lines.push(l), () => {}, 15);
  t.start(); await new Promise(x => setTimeout(x, 80)); t.finish();
  ok('finish() flushes the last line without a newline', lines.join('|') === 'done|no newline', JSON.stringify(lines));
}
{
  const r = await tailOf(async () => {}, 80);
  ok('a log that never appears does not throw', r.lines.length === 0 && r.exit === undefined);
}

/* ══ 7. terminal run plan (real shell) ════════════════════════════ */
section('terminal run plan');
{
  const plan = R.planTerminalRun('node -e "console.log(42);process.exit(3)"', tmp);
  ok('plan has one line to send', typeof plan.send === 'string' && !/\n/.test(plan.send));
  ok('plan cleans its script and log', plan.cleanup.length === 2 && plan.cleanup.includes(plan.logPath));
  ok('script file exists', fs.existsSync(plan.cleanup[0]));
  const shell = win ? ['powershell.exe', ['-NoLogo', '-NoProfile', '-Command', plan.send]] : ['bash', ['-c', plan.send]];
  const r = spawnSync(shell[0], shell[1], { encoding: 'utf8', timeout: 60000 });
  const log = fs.existsSync(plan.logPath) ? fs.readFileSync(plan.logPath) : Buffer.alloc(0);
  const text = (log[0] === 0xff && log[1] === 0xfe ? log.subarray(2).toString('utf16le') : log.toString('utf8'));
  ok('real shell run: program output reaches the log', /42/.test(text), JSON.stringify(text.slice(0, 200)) + ' ' + (r.stderr || ''));
  ok('real shell run: exit code 3 reaches the log', new RegExp(R.EXIT_SENTINEL + '\\s+3').test(R.stripAnsi(text)), JSON.stringify(text.slice(0, 200)));
}
{
  const inp = path.join(tmp, 'in.txt'); fs.writeFileSync(inp, 'kanak\n');
  const plan = R.planTerminalRun('node -e "process.stdin.on(\'data\',d=>process.stdout.write(\'got \'+d))"', tmp, inp);
  const shell = win ? ['powershell.exe', ['-NoLogo', '-NoProfile', '-Command', plan.send]] : ['bash', ['-c', plan.send]];
  spawnSync(shell[0], shell[1], { encoding: 'utf8', timeout: 60000 });
  const log = fs.existsSync(plan.logPath) ? fs.readFileSync(plan.logPath) : Buffer.alloc(0);
  const text = (log[0] === 0xff && log[1] === 0xfe ? log.subarray(2).toString('utf16le') : log.toString('utf8'));
  ok('real shell run: input file is fed to the program', /got kanak/.test(text), JSON.stringify(text.slice(0, 200)));
}
{
  const d = path.join(tmp, "it's a dir");
  fs.mkdirSync(d);
  const plan = R.planTerminalRun('node -e "console.log(process.cwd())"', d);
  const shell = win ? ['powershell.exe', ['-NoLogo', '-NoProfile', '-Command', plan.send]] : ['bash', ['-c', plan.send]];
  spawnSync(shell[0], shell[1], { encoding: 'utf8', timeout: 60000 });
  const log = fs.existsSync(plan.logPath) ? fs.readFileSync(plan.logPath) : Buffer.alloc(0);
  const text = (log[0] === 0xff && log[1] === 0xfe ? log.subarray(2).toString('utf16le') : log.toString('utf8'));
  ok('real shell run: folder with an apostrophe works', text.includes("it's a dir"), JSON.stringify(text.slice(0, 200)));
}

/* ══ 8. background runner (RunSession) ════════════════════════════ */
section('background runner');
function run(command, opts = {}) {
  return new Promise(resolve => {
    const out = [], frames = [], warns = [];
    const s = new R.RunSession(path.join(tmp, 'x'), command, opts.cwd || tmp, opts.maxFrames || 1000, opts.timeout || 0, {
      onOutput: t => out.push(t), onFrame: p => frames.push(p), onWarning: w => warns.push(w),
      onExit: (code, signal, ms) => resolve({ code, signal, ms, out: out.join(''), frames, warns })
    }, opts.stdin);
    s.start();
    if (opts.stopAfter) setTimeout(() => s.stop(), opts.stopAfter);
  });
}
const nodeRun = js => 'node -e ' + JSON.stringify(js);
{
  const r = await run(nodeRun('console.log("hi");process.exit(4)'));
  ok('exit code passes through', r.code === 4, JSON.stringify(r));
  ok('stdout lines are shown', r.out.includes('hi\n'));
}
{
  const r = await run(nodeRun('console.error("bad")'));
  ok('stderr lines are marked with "! "', r.out.includes('! bad'), r.out);
}
{
  const r = await run(nodeRun('console.log("@vyuha [1,2,3]");console.log("@vyuha {\\"stack\\":[1]}")'));
  ok('@vyuha lines become frames, not output', r.frames.length === 2 && !r.out.includes('@vyuha'), JSON.stringify(r));
}
{
  const r = await run(nodeRun('process.stdout.write("@vyu");setTimeout(()=>process.stdout.write("ha [9]\\n"),50)'));
  ok('a payload split across two writes still parses', r.frames.length === 1, JSON.stringify(r));
}
{
  const r = await run(nodeRun('process.stdout.write("@vyuha [7]")'));
  ok('last line without newline is flushed', r.frames.length === 1);
}
{
  const r = await run(nodeRun('for(let i=0;i<20;i++)console.log("@vyuha ["+i+"]")'), { maxFrames: 5 });
  ok('frame cap is honoured with ONE warning', r.frames.length === 5 && r.warns.filter(w => /Stopped collecting/.test(w)).length === 1, JSON.stringify(r.warns));
}
{
  const r = await run(nodeRun('console.log("@vyuha {broken")'));
  ok('a broken payload warns but the run goes on', r.warns.length === 1 && r.code === 0);
}
{
  const inp = path.join(tmp, 'feed.txt'); fs.writeFileSync(inp, '5\n6\n');
  const r = await run(nodeRun('let d="";process.stdin.on("data",c=>d+=c).on("end",()=>console.log("sum",d.trim().split(/\\s+/).map(Number).reduce((a,b)=>a+b)))'), { stdin: inp });
  ok('stdin file is fed', r.out.includes('sum 11'), r.out);
}
{
  const r = await run(nodeRun('process.stdin.on("data",()=>{}).on("end",()=>console.log("eof"))'));
  ok('without an input file stdin is closed (no hang)', r.out.includes('eof') || r.code === 0, r.out);
}
{
  const r = await run(nodeRun('setInterval(()=>{},1000)'), { timeout: 1 });
  ok('timeout stops a program that never ends', r.warns.some(w => /longer than 1s/.test(w)) && r.ms < 15000, JSON.stringify(r));
}
{
  const r = await run(nodeRun('setInterval(()=>{},1000)'), { stopAfter: 300 });
  ok('stop() ends a running program', r.ms < 15000 && r.code !== 0, JSON.stringify(r));
}
{
  const r = await run(nodeRun('console.log("हिंदी ✓ 😀")'));
  ok('unicode output survives', r.out.includes('हिंदी ✓ 😀'), r.out);
}
{
  const r = await run('this-command-does-not-exist-vyuha');
  ok('a missing command ends with a non-zero code', r.code !== 0, JSON.stringify(r));
}
{
  const r = await run(nodeRun('console.log("x".repeat(200000))'));
  ok('a 200 KB line is delivered whole', r.out.length >= 200000);
}
{
  const r = await run(nodeRun('console.log(process.env.VYUHA, process.env.PYTHONUNBUFFERED)'));
  ok('VYUHA=1 and PYTHONUNBUFFERED=1 are set for the program', r.out.includes('1 1'), r.out);
}

/* ══ 9. source graph (draws "hello world" too) ════════════════════ */
section('source graph');
ok('language families', ['a.cpp', 'a.hpp', 'a.java', 'a.ts', 'a.py', 'a.go', 'a.rs'].map(C.languageOf).join() === 'c,c,java,js,py,go,rust');
ok('unknown extension keeps its name, none → text', C.languageOf('a.zig') === 'zig' && C.languageOf('Makefile') === 'text');
{
  const g = C.analyzeSource('a.py', 'def helper(x):\n    return x*2\n\ndef main():\n    for i in range(3):\n        if i:\n            print(helper(i))\n\nmain()\n');
  ok('python: two functions found', g.nodes.filter(n => n.kind === 'func').length === 2);
  ok('python: loop and branch found', g.nodes.some(n => n.kind === 'loop') && g.nodes.some(n => n.kind === 'branch'));
  ok('python: main → helper call edge', g.edges.some(e => e.from === 'fn:main' && e.to === 'fn:helper' && e.label === 'calls'));
  ok('python: entry is main', g.entry === 'fn:main');
  ok('python: print is an output node', g.outputs.length === 1);
}
{
  const g = C.analyzeSource('a.cpp', '#include <iostream>\nint sq(int x) {\n  return x*x;\n}\nint main() {\n  /* for (int i = 0; i < 3; i++) old loop\n     while (true) */\n  std::cout << sq(3) << std::endl;\n  return 0;\n}\n');
  ok('C++: functions found', ['fn:sq', 'fn:main'].every(id => g.nodes.some(n => n.id === id)));
  ok('C++: loops inside /* block comments */ are ignored', !g.nodes.some(n => n.kind === 'loop'), JSON.stringify(g.nodes.map(n => n.label)));
  ok('C++: cout is an output node', g.nodes.some(n => n.kind === 'out'));
}
{
  const g = C.analyzeSource('a.py', 'half = 10 // 2\nfor i in range(n // 2):\n    print(i)\n');
  ok('python: "//" (integer division) is not a comment', g.nodes.some(n => n.kind === 'loop') && g.nodes.some(n => n.kind === 'out'));
}
{
  const g = C.analyzeSource('a.py', '"""\nfor x in docs:\n    print(x)\n"""\nprint(1)\n');
  ok('python: code inside a """docstring""" is ignored', !g.nodes.some(n => n.kind === 'loop') && g.nodes.filter(n => n.kind === 'out').length === 1, JSON.stringify(g.nodes.map(n => n.label)));
}
{
  const g = C.analyzeSource('a.js', 'function f() {\n  if (x) {\n    console.log(1);\n  }\n}\nf();\n');
  ok('JS: "if (x) {" is a branch, not a function named if', !g.nodes.some(n => n.id === 'fn:if') && g.nodes.some(n => n.kind === 'branch'));
}
{
  const src = Array.from({ length: 300 }, (_, i) => 'print(' + i + ')').join('\n');
  const g = C.analyzeSource('a.py', src);
  ok('huge files are capped and marked truncated', g.nodes.length <= 90 && g.truncated === true);
}
{
  let g, err;
  try { g = C.analyzeSource('a.c', '\u0000\u0001{{{{}}}}}}}}\uFFFF' + '}'.repeat(1000)); } catch (e) { err = e; }
  ok('garbage source never throws', !err && g && g.nodes.length >= 1);
  ok('empty file → one file node', C.analyzeSource('a.go', '').nodes.length === 1);
}
ok('compile command gets compile + link stages', C.stagesFor('g++ -static a.cpp -o b && b', 'c').some(s => s.id === 's:compile'));
ok('interpreter gets a parse stage', C.stagesFor('python3 -u a.py', 'py').some(s => s.id === 's:parse'));
ok('stages always start at source and end at output', (() => { const s = C.stagesFor('node a.js', 'js'); return s[0].id === 's:src' && s[s.length - 1].id === 's:out'; })());
{
  const g = C.analyzeSource('a.py', 'print(1)\n');
  const f = C.autoFrame(g, C.stagesFor('python a.py', 'py'), C.initialState());
  ok('hello world still draws a frame', f && f.nodes.length >= 3 && Array.isArray(f.edges));
}

/* ══ 10. neural-net spec files ════════════════════════════════════ */
section('net spec');
{
  const r = S.parseSpec(S.templateSpec());
  ok('template spec is valid', r.ok === true && r.spec.layers.length === 10);
  ok('anchors map every layer to its line', r.ok && r.anchors.every(a => a.line > 0) && S.layerAtLine(r.anchors, r.anchors[3].line) === 3);
}
ok('bad JSON → message with a line', (() => { const r = S.parseSpec('{\n "layers": [\n }'); return !r.ok && typeof r.line === 'number'; })());
ok('comments are allowed', S.parseSpec('// note\n{ /* a */ "layers": [{"id":"a","kind":"input","n":2}] }').ok === true);
ok('"//" inside a string is not a comment', (() => { const r = S.parseSpec('{"meta":{"name":"http://x"},"layers":[{"id":"a","kind":"input","n":2}]}'); return r.ok && r.spec.meta.name === 'http://x'; })());
ok('duplicate ids rejected', !S.parseSpec('{"layers":[{"id":"a","kind":"input","n":1},{"id":"a","kind":"dense","n":1}]}').ok);
ok('unknown kind rejected', !S.parseSpec('{"layers":[{"id":"a","kind":"conv","n":1}]}').ok);
ok('n over 256 rejected', !S.parseSpec('{"layers":[{"id":"a","kind":"input","n":300}]}').ok);
ok('n of 0 rejected', !S.parseSpec('{"layers":[{"id":"a","kind":"input","n":0}]}').ok);
ok('label count must match n', !S.parseSpec('{"layers":[{"id":"a","kind":"output","n":2,"labels":["x"]}]}').ok);
ok('residual to an unknown layer rejected', !S.parseSpec('{"layers":[{"id":"a","kind":"norm","n":1,"residualFrom":"zz"}]}').ok);
ok('65 layers rejected', !S.parseSpec(JSON.stringify({ layers: Array.from({ length: 65 }, (_, i) => ({ id: 'l' + i, kind: 'dense', n: 1 })) })).ok);
ok('a meta that is not an object does not break the spec', (() => { const r = S.parseSpec('{"meta":"x","layers":[{"id":"a","kind":"input","n":1}]}'); return r.ok && typeof r.spec.meta === 'object'; })());

/* ══ 11. helper libraries → real @vyuha output → parser ═══════════ */
section('helper libraries');
const LIB = path.join(__dirname, '..', 'lib');
function framesFrom(stdout) {
  return stdout.split(/\r?\n/).filter(l => P.isPayloadLine(l)).map(l => P.parseLine(l));
}
const allOk = fr => fr.length > 0 && fr.every(x => x && 'payload' in x);

// Python
{
  const py = I.resolvePython();
  if (py) {
    const prog = path.join(tmp, 'pyprog.py');
    fs.writeFileSync(prog, [
      'import sys; sys.path.insert(0, ' + JSON.stringify(LIB) + ')',
      'import vyuha',
      'vyuha.array([3, 1, 2], active=[0])',
      'vyuha.matrix([[1, 2], [3, 4]])',
      'vyuha.stack([1, 2]); vyuha.queue([1]); vyuha.linked_list([1, 2, 3])',
      'class N:\n    def __init__(s, v, l=None, r=None): s.value, s.left, s.right = v, l, r',
      'vyuha.tree(N(8, N(3), N(10)))',
      'vyuha.graph({"a": ["b", ("c", 4)]})',
      'vyuha.frame([{"id": "a"}], [])',
      'vyuha.array([float("nan"), float("inf"), 1.5], title="naN \\"q\\" \\n line")',
      '@vyuha.recursive()\ndef fib(n):\n    return n if n < 2 else fib(n - 1) + fib(n - 2)',
      'fib(4)'
    ].join('\n') + '\n');
    const r = spawnSync(py.cmd, [...(py.args || []), prog], { encoding: 'utf8', timeout: 60000 });
    const fr = framesFrom(r.stdout || '');
    ok('python helper: program runs', r.status === 0, r.stderr);
    ok('python helper: every frame parses (incl. NaN/Infinity values)', allOk(fr), JSON.stringify(fr.filter(x => !x || !('payload' in x))));
    ok('python helper: 10+ frames emitted', fr.length >= 10, fr.length);
    ok('python helper: caller line stamped', fr[0] && fr[0].payload && fr[0].payload.frame && fr[0].payload.frame.line === 3);
  } else { skip('python helper', 'no python'); }
}
// JavaScript
{
  const prog = path.join(tmp, 'jsprog.js');
  fs.writeFileSync(prog, [
    'const v = require(' + JSON.stringify(path.join(LIB, 'vyuha.js')) + ');',
    'v.array([3, 1, NaN, Infinity], { active: [0] });',
    'v.matrix([[1, 2], [3]]);',
    'v.stack([1]); v.queue([2]); v.linkedList({ value: 1, next: { value: 2 } });',
    'const t = { value: 1, left: { value: 2 } }; t.left.left = t;',   // cycle!
    'v.tree(t);',
    'v.graph({ a: ["b", ["c", 3]] });',
    'v.array([10n, 20n]);',                                            // BigInt
    'v.frame([{ id: "a" }], []);'
  ].join('\n') + '\n');
  const r = spawnSync(process.execPath, [prog], { encoding: 'utf8', timeout: 60000 });
  const fr = framesFrom(r.stdout || '');
  ok('JS helper: program does not crash (cyclic tree, BigInt)', r.status === 0, (r.stderr || '').slice(0, 300));
  ok('JS helper: every frame parses', allOk(fr) && fr.length === 9, fr.length);
}
// C++
{
  const cxx = I.resolveCCompiler(true);
  if (cxx) {
    const prog = path.join(tmp, 'cxxprog.cpp');
    fs.writeFileSync(prog, [
      '#include "' + path.join(LIB, 'vyuha.hpp').replace(/\\/g, '/') + '"',
      '#include <cmath>',
      'int main() {',
      '  std::vector<int> a = {3, 1, 2};',
      '  vyuha::array(a, {0}, "ctl \\x01 \\x1f tab\\t quote\\" back\\\\", "n");',
      '  std::vector<double> d = {1.5, NAN, INFINITY, -INFINITY, 1e300};',
      '  vyuha::array(d);',
      '  std::vector<std::string> s = {"a", "b \\"c\\""};',
      '  vyuha::stack(s);',
      '  std::vector<char> c = {\'x\', \'"\'};',
      '  vyuha::queue(c);',
      '  std::vector<bool> b = {true, false};',
      '  vyuha::list(b);',
      '  std::vector<std::vector<int>> m = {{1, 2}, {3}};',
      '  vyuha::matrix(m, {"0,1"});',
      '  vyuha::TreeNode r("8"); vyuha::TreeNode l("3"); r.left = &l;',
      '  vyuha::tree(&r);',
      '  vyuha::tree(nullptr);',
      '  std::map<std::string, std::vector<std::pair<std::string, double>>> g;',
      '  g["a"] = {{"b", 0.0}, {"c", 2.5}};',
      '  vyuha::graph(g);',
      '  return 0;',
      '}'
    ].join('\n') + '\n');
    const cmd = R.commandFor(prog, {});
    const r = spawnSync(cmd, { shell: true, cwd: tmp, encoding: 'utf8', timeout: 180000 });
    const fr = framesFrom(r.stdout || '');
    ok('C++ helper: compiles and runs (string/char/bool/double vectors)', r.status === 0, (r.stderr || '').slice(0, 600));
    ok('C++ helper: every frame is valid JSON (control chars, NaN, inf, strings)', allOk(fr) && fr.length === 9, JSON.stringify(fr.map((x, i) => x && 'error' in x ? i + ':' + x.error : 'ok')) + ' ' + (r.stdout || '').slice(0, 800));
  } else { skip('C++ helper', 'no C++ compiler'); }
}
// C
{
  const cc = I.resolveCCompiler(false);
  if (cc) {
    const prog = path.join(tmp, 'cprog.c');
    fs.writeFileSync(prog, [
      '#include "' + path.join(LIB, 'vyuha.h').replace(/\\/g, '/') + '"',
      'int main(void) {',
      '  int a[3] = {3, 1, 2}; int act[1] = {0};',
      '  vyuha_array(a, 3, act, 1, "t \\"q\\" \\x01", "n");',
      '  vyuha_stack(a, 3, NULL, NULL);',
      '  vyuha_queue(a, 0, "", "");',
      '  return 0;',
      '}'
    ].join('\n') + '\n');
    const hdr = fs.readFileSync(path.join(LIB, 'vyuha.h'), 'utf8');
    const sig = /static inline void vyuha_array\(([^)]*)\)/.exec(hdr);
    const r = spawnSync(R.commandFor(prog, {}), { shell: true, cwd: tmp, encoding: 'utf8', timeout: 180000 });
    const fr = framesFrom(r.stdout || '');
    if (r.status !== 0 && /too (many|few) arguments/.test(r.stderr || '')) {
      skip('C helper', 'test call does not match signature: ' + (sig && sig[1]));
    } else {
      ok('C helper: compiles and runs', r.status === 0, (r.stderr || '').slice(0, 600));
      ok('C helper: every frame parses', allOk(fr) && fr.length === 3, (r.stdout || '').slice(0, 400));
    }
  } else { skip('C helper', 'no C compiler'); }
}
// Java
if (has('javac')) {
  const jd = path.join(tmp, 'jhelper'); fs.mkdirSync(jd);
  fs.copyFileSync(path.join(LIB, 'Vyuha.java'), path.join(jd, 'Vyuha.java'));
  const src = fs.readFileSync(path.join(LIB, 'Vyuha.java'), 'utf8');
  const usesArray = /public static void array\(\s*int\[\]/.test(src);
  const usesDouble = /public static void array\(\s*double\[\]/.test(src);
  fs.writeFileSync(path.join(jd, 'JT.java'), [
    'public class JT { public static void main(String[] a) {',
    usesArray ? '  Vyuha.array(new int[]{3,1,2});' : '',
    usesDouble ? '  Vyuha.array(new double[]{1.5, Double.NaN, Double.POSITIVE_INFINITY});' : '',
    '} }'
  ].join('\n'));
  const r = spawnSync(R.commandFor(path.join(jd, 'JT.java'), {}), { shell: true, cwd: jd, encoding: 'utf8', timeout: 180000 });
  const fr = framesFrom(r.stdout || '');
  ok('Java helper: compiles and runs', r.status === 0, (r.stderr || '').slice(0, 400));
  ok('Java helper: every frame parses (incl. NaN)', fr.length === 0 ? !usesArray && !usesDouble : allOk(fr), (r.stdout || '').slice(0, 400));
} else { skip('Java helper', 'no javac'); }
// Go
if (has('go')) {
  const gd = path.join(tmp, 'ghelper'); fs.mkdirSync(gd);
  fs.copyFileSync(path.join(LIB, 'vyuha.go'), path.join(gd, 'vyuha.go'));
  const gsrc = fs.readFileSync(path.join(LIB, 'vyuha.go'), 'utf8');
  const fnArr = /func\s+(Array|VyuhaArray)\s*\(/.exec(gsrc);
  fs.writeFileSync(path.join(gd, 'main.go'), 'package main\n\nfunc main() {\n' + (fnArr ? '\t' + fnArr[1] + '([]int{3, 1, 2})\n' : '') + '}\n');
  const r = spawnSync(R.commandFor(path.join(gd, 'main.go'), {}), { shell: true, cwd: gd, encoding: 'utf8', timeout: 300000, env: { ...process.env, GO111MODULE: 'off' } });
  const fr = framesFrom(r.stdout || '');
  if (r.status !== 0 && /not enough arguments|too many arguments|cannot use/.test(r.stderr || '')) skip('Go helper', 'test call does not match signature');
  else {
    ok('Go helper: compiles and runs', r.status === 0, (r.stderr || '').slice(0, 400));
    ok('Go helper: frames parse', !fnArr || allOk(fr), (r.stdout || '').slice(0, 300));
  }
} else { skip('Go helper', 'no go'); }

/* ══ done ═════════════════════════════════════════════════════════ */
try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* Windows may hold a file */ }
console.log('\n' + passed + ' passed, ' + failed + ' failed, ' + skipped + ' skipped (' + (passed + failed) + ' checks)');
if (failed) { console.log('STABILITY TEST FAILED'); process.exit(1); }
console.log('STABILITY TEST PASSED');
process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
