/**
 * Two things are checked here.
 *
 * 1. The source reader: given real programs in several languages, does it find
 *    the functions, the loops and the printing statements, and does the frame
 *    it builds satisfy the same shape the renderer expects from any other frame?
 *
 * 2. The terminal path: the command VYUHA sends to the terminal is executed for
 *    real, and the log tail has to see the program's output and its exit code.
 *    This is the part that used to hang, so it is the part worth executing
 *    rather than reasoning about.
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const {
  analyzeSource, stagesFor, autoFrame, initialState, languageOf
} = require('../out/codegraph.js');
const { planTerminalRun, LogTail, stripAnsi } = require('../out/runner.js');

let failures = 0;
function check(name, fn) {
  try { fn(); console.log('  ok   ' + name); }
  catch (err) { failures++; console.log('  FAIL ' + name + '\n       ' + err.message); }
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vyuha-auto-'));
const write = (name, body) => { const p = path.join(tmp, name); fs.writeFileSync(p, body); return p; };

/* ── 1. the source reader ──────────────────────────────────────── */

console.log('\nsource reader');

const helloCpp = write('hello.cpp', `#include <iostream>
using namespace std;

int main() {
    cout << "Hello World" << endl;
    return 0;
}
`);

check('a hello world in C++ yields a main and a print', () => {
  const cg = analyzeSource(helloCpp, fs.readFileSync(helloCpp, 'utf8'));
  assert.strictEqual(cg.language, 'c');
  assert.ok(cg.nodes.some(n => n.id === 'fn:main'), 'main not found');
  assert.strictEqual(cg.outputs.length, 1, 'expected exactly one print statement');
  assert.strictEqual(cg.entry, 'fn:main');
});

const treeCpp = write('tree.cpp', `#include <iostream>
using namespace std;

struct Node {
    int data;
    Node* lchild;
    Node* rchild;
};

Node* createNode(int value) {
    Node* n = new Node;
    n->data = value;
    n->lchild = NULL;
    n->rchild = NULL;
    return n;
}

Node* createTree() {
    int value;
    cout << "Enter value: ";
    cin >> value;
    if (value == -1) return NULL;
    Node* root = createNode(value);
    root->lchild = createTree();
    root->rchild = createTree();
    return root;
}

void preorder(Node* root) {
    if (root == NULL) return;
    cout << root->data << " ";
    preorder(root->lchild);
    preorder(root->rchild);
}

int main() {
    Node* root = createTree();
    preorder(root);
    cout << endl;
    return 0;
}
`);

check('a recursive binary tree program yields its functions and their calls', () => {
  const cg = analyzeSource(treeCpp, fs.readFileSync(treeCpp, 'utf8'));
  for (const fn of ['createNode', 'createTree', 'preorder', 'main']) {
    assert.ok(cg.nodes.some(n => n.id === 'fn:' + fn), fn + ' not found');
  }
  assert.ok(cg.nodes.some(n => n.kind === 'read'), 'the cin read was not spotted');
  assert.ok(
    cg.edges.some(e => e.from === 'fn:main' && e.to === 'fn:createTree'),
    'main -> createTree call edge missing'
  );
  assert.ok(cg.outputs.length >= 3, 'expected several print statements');
});

check('Python is read by indentation', () => {
  const p = write('t.py', [
    'def greet(name):',
    '    for i in range(3):',
    '        print("hi", name)',
    '    return name',
    '',
    'greet("kanak")'
  ].join('\n'));
  const cg = analyzeSource(p, fs.readFileSync(p, 'utf8'));
  assert.strictEqual(cg.language, 'py');
  assert.ok(cg.nodes.some(n => n.id === 'fn:greet'));
  assert.ok(cg.nodes.some(n => n.kind === 'loop'), 'the for loop was not spotted');
  assert.strictEqual(cg.outputs.length, 1);
});

check('JavaScript and Go are read too', () => {
  const js = write('t.js', 'function add(a,b){ return a+b; }\nconsole.log(add(1,2));\n');
  const cgj = analyzeSource(js, fs.readFileSync(js, 'utf8'));
  assert.ok(cgj.nodes.some(n => n.id === 'fn:add'));
  assert.strictEqual(cgj.outputs.length, 1);

  const go = write('t.go', 'package main\nimport "fmt"\nfunc main() {\n\tfmt.Println("hi")\n}\n');
  const cgg = analyzeSource(go, fs.readFileSync(go, 'utf8'));
  assert.strictEqual(cgg.language, 'go');
  assert.ok(cgg.nodes.some(n => n.id === 'fn:main'));
  assert.strictEqual(cgg.outputs.length, 1);
});

check('comments and strings do not create phantom nodes', () => {
  const p = write('c.cpp', [
    '#include <iostream>',
    'int main() {',
    '    // for this is a comment with cout in it',
    '    const char* s = "while (true) printf";',
    '    return 0;',
    '}'
  ].join('\n'));
  const cg = analyzeSource(p, fs.readFileSync(p, 'utf8'));
  assert.strictEqual(cg.outputs.length, 0, 'a comment was mistaken for a print');
  assert.ok(!cg.nodes.some(n => n.kind === 'loop'), 'a string was mistaken for a loop');
});

check('an empty or unreadable file still draws', () => {
  const cg = analyzeSource('/tmp/nothing.xyz', '');
  assert.ok(cg.nodes.length >= 1);
  assert.strictEqual(cg.entry, 'file');
});

check('a very large file is capped instead of flooding the view', () => {
  let body = 'int main() {\n';
  for (let i = 0; i < 400; i++) body += '  printf("x");\n';
  body += '}\n';
  const p = write('big.c', body);
  const cg = analyzeSource(p, body);
  assert.ok(cg.nodes.length <= 90, 'node cap not applied: ' + cg.nodes.length);
  assert.ok(cg.truncated, 'truncation was not reported');
});

/* ── 2. the frames handed to the renderer ──────────────────────── */

console.log('\nframes');

check('stages depend on whether the language compiles', () => {
  const c = stagesFor('c++ -O2 a.cpp -o bin && bin', 'c').map(s => s.id);
  assert.ok(c.includes('s:compile') && c.includes('s:link'), 'compile stages missing');
  const py = stagesFor('python3 -u a.py', 'py').map(s => s.id);
  assert.ok(!py.includes('s:compile'), 'python should not compile');
  assert.ok(py.includes('s:parse'));
});

check('an auto frame has the shape every renderer frame has', () => {
  const cg = analyzeSource(treeCpp, fs.readFileSync(treeCpp, 'utf8'));
  const stages = stagesFor('c++ a.cpp -o bin && bin', 'c');
  const st = initialState();
  st.stages['s:src'] = 'done';
  st.code['fn:main'] = 'active';
  const f = autoFrame(cg, stages, st);

  assert.strictEqual(f.kind, 'graph');
  assert.ok(Array.isArray(f.nodes) && f.nodes.length > stages.length);
  const ids = new Set(f.nodes.map(n => n.id));
  assert.strictEqual(ids.size, f.nodes.length, 'duplicate node ids');
  const states = ['normal', 'active', 'visited', 'done', 'error'];
  for (const n of f.nodes) {
    assert.ok(typeof n.id === 'string' && n.id, 'node without an id');
    assert.ok(typeof n.label === 'string', 'node without a label');
    assert.ok(states.includes(n.state), 'bad state ' + n.state);
  }
  for (const e of f.edges) {
    assert.ok(ids.has(e.from), 'edge from a node that is not in the frame: ' + e.from);
    assert.ok(ids.has(e.to), 'edge to a node that is not in the frame: ' + e.to);
    assert.ok(states.includes(e.state));
  }
  assert.ok(f.nodes.find(n => n.id === 'fn:main').state === 'active');
});

check('the node set is identical across frames, so the layout stays still', () => {
  const cg = analyzeSource(helloCpp, fs.readFileSync(helloCpp, 'utf8'));
  const stages = stagesFor('c++ a.cpp -o bin && bin', 'c');
  const a = autoFrame(cg, stages, initialState());
  const st = initialState();
  st.code['fn:main'] = 'done';
  st.outCount = 3;
  const b = autoFrame(cg, stages, st);
  assert.deepStrictEqual(a.nodes.map(n => n.id), b.nodes.map(n => n.id));
  assert.deepStrictEqual(a.edges.map(e => e.from + '>' + e.to), b.edges.map(e => e.from + '>' + e.to));
});

/* ── 3. the terminal path, executed for real ───────────────────── */

console.log('\nterminal run');

function runPlanned(command, cwd, stdinFile) {
  const plan = planTerminalRun(command, cwd, stdinFile);
  const lines = [];
  let exitCode;
  const tail = new LogTail(plan.logPath, l => lines.push(l), c => { exitCode = c; }, 30);
  tail.start();
  try {
    execFileSync('/bin/bash', ['-lc', plan.send], { stdio: 'ignore', timeout: 30000 });
  } catch (err) {
    // A non-zero exit from the program itself is expected in one of the cases.
  }
  // execFileSync already waited for the program; finish() drains what is left.
  tail.finish();
  for (const f of plan.cleanup) { try { fs.unlinkSync(f); } catch {} }
  return { lines, exitCode, plan };
}

check('a plain echo is captured with its exit code', () => {
  const r = runPlanned('echo hello-from-vyuha', tmp);
  assert.ok(r.lines.some(l => l.includes('hello-from-vyuha')), 'output not captured: ' + JSON.stringify(r.lines));
  assert.strictEqual(r.exitCode, 0);
});

check('a failing command reports its real exit code', () => {
  const r = runPlanned('exit 3', tmp);
  assert.strictEqual(r.exitCode, 3);
});

check('a C++ program that reads stdin does not hang', () => {
  const src = write('sum.cpp', `#include <iostream>
int main(){ int a,b; std::cin >> a >> b; std::cout << "sum " << (a+b) << std::endl; return 0; }
`);
  const bin = path.join(tmp, 'sum');
  try {
    execFileSync('c++', ['-std=c++17', src, '-o', bin], { stdio: 'ignore' });
  } catch {
    console.log('       (no C++ compiler here — skipped)');
    return;
  }
  const inputFile = write('sum.stdin', '20\n22\n');
  const r = runPlanned('"' + bin + '"', tmp, inputFile);
  assert.ok(r.lines.some(l => l.includes('sum 42')), 'program output missing: ' + JSON.stringify(r.lines));
  assert.strictEqual(r.exitCode, 0);
});

check('an @vyuha line survives the terminal round trip', () => {
  const r = runPlanned(`printf '@vyuha {"array":[3,1,2],"active":[0]}\\n'`, tmp);
  const hit = r.lines.map(stripAnsi).find(l => l.includes('@vyuha'));
  assert.ok(hit, 'the payload line did not come back: ' + JSON.stringify(r.lines));
  const { parseLine } = require('../out/protocol.js');
  const parsed = parseLine(hit);
  assert.ok(parsed && parsed.payload, 'the payload no longer parses after the terminal');
  assert.strictEqual(parsed.payload.frame.nodes.length, 3);
});

check('colour codes are stripped out of the log', () => {
  assert.strictEqual(stripAnsi('\u001b[32mgreen\u001b[0m'), 'green');
  assert.strictEqual(stripAnsi('over\rwrite'), 'overwrite');
});

/* ── done ──────────────────────────────────────────────────────── */

try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {}

if (failures) {
  console.log('\nAUTO TEST FAILED — ' + failures + ' check(s)\n');
  process.exit(1);
}
console.log('\nAUTO TEST PASSED\n');
