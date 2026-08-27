/**
 * Exercises the protocol parser and the language runner against real programs.
 * Anything that is actually installed on this machine gets run for real; the
 * rest are checked for a correct command line and skipped.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execSync, spawnSync } = require('child_process');

const { parseLine, normalise, isPayloadLine } = require(__dirname + '/../out/protocol.js');
const { RUNNERS, commandFor, expand, knownExtensions } = require(__dirname + '/../out/runner.js');

let failures = 0;
function ok(label, cond, detail) {
  console.log((cond ? 'OK   ' : 'FAIL ') + label + (detail !== undefined ? '  ' + detail : ''));
  if (!cond) failures++;
}

/* ══ 1 · the wire protocol ═══════════════════════════════════ */
console.log('— protocol —');

ok('plain output is not a payload', parseLine('hello world') === null);
ok('a payload line is recognised', isPayloadLine('@vyuha {"array":[1]}'));
ok('# comment prefix accepted', isPayloadLine('# vyuha {"array":[1]}'));
ok('// comment prefix accepted', isPayloadLine('//vyuha {"array":[1]}'));
ok('leading whitespace tolerated', isPayloadLine('   @vyuha {"array":[1]}'));

const broken = parseLine('@vyuha not json at all');
ok('a broken payload reports an error rather than throwing', broken && 'error' in broken, broken && broken.error);

const bare = parseLine('@vyuha [4,1,7]');
ok('a bare array becomes an array frame',
   bare && bare.payload && bare.payload.frame.kind === 'array' && bare.payload.frame.nodes.length === 3);

const shapes = {
  'array':     { array: [3, 1, 2], active: [0] },
  'matrix':    { matrix: [[1, 2], [3, 4]], active: ['0,1'] },
  'list':      { list: ['a', 'b', 'c'] },
  'stack':     { stack: [1, 2] },
  'queue':     { queue: [1, 2] },
  'tree':      { tree: { value: 1, left: { value: 2 }, right: { value: 3 } } },
  'graph':     { adjacency: { a: ['b'], b: [['c', 3]] } }
};
for (const [kind, raw] of Object.entries(shapes)) {
  try {
    const p = normalise(raw);
    ok('normalise ' + kind, p.type === 'ds' && p.frame.kind === kind,
       p.frame.nodes.length + ' nodes / ' + p.frame.edges.length + ' edges');
  } catch (e) {
    ok('normalise ' + kind, false, e.message);
  }
}

/* every node carries the fields the renderer relies on */
const arr = normalise({ array: [5, 3], active: [1], title: 'T', note: 'N' }).frame;
ok('title and note survive', arr.title === 'T' && arr.note === 'N');
ok('active marks the right node', arr.nodes[1].state === 'active' && arr.nodes[0].state === 'normal');
ok('values are kept for bar heights', arr.nodes[0].value === 5);

const g = normalise({ adjacency: { a: [['b', 4]] } }).frame;
ok('a weighted edge keeps its weight', g.edges[0].weight === 4 && g.edges[0].label === '4');
ok('an implied node is created', g.nodes.length === 2);

const t = normalise({ tree: { value: 1, children: [{ value: 2 }, { value: 3 }] } }).frame;
ok('children arrays work as well as left/right', t.nodes.length === 3 && t.edges.length === 2);

const explicit = normalise({
  nodes: [{ id: 'x', label: 'X', x: 1, y: 2, z: 3, state: 'done' }, { id: 'y' }],
  edges: [{ from: 'x', to: 'y', state: 'active', directed: false }]
}).frame;
ok('explicit coordinates pass through', explicit.nodes[0].x === 1 && explicit.nodes[0].z === 3);
ok('an undirected edge stays undirected', explicit.edges[0].directed === false);

const dangling = normalise({ nodes: [{ id: 'a' }], edges: [{ from: 'a', to: 'ghost' }] }).frame;
ok('an edge to a missing node is dropped', dangling.edges.length === 0);

const net = normalise({ layers: [{ id: 'in', name: 'Input', kind: 'input', n: 4 }] });
ok('a layers payload routes to the network renderer', net.type === 'net');

let threw = false;
try { normalise({ nothing: true }); } catch { threw = true; }
ok('an unusable payload is rejected clearly', threw);

/* ══ 2 · command expansion ═══════════════════════════════════ */
console.log('\n— runner table —');

ok('the built-in table is broad', Object.keys(RUNNERS).length >= 30, Object.keys(RUNNERS).length + ' extensions');
ok('python maps to python3', (commandFor('/tmp/a.py', {}) || '').startsWith('python3'));
ok('an unknown extension returns null', commandFor('/tmp/a.qqq', {}) === null);
ok('a user override wins', commandFor('/tmp/a.py', { py: 'mypython "${file}"' }) === 'mypython "/tmp/a.py"');
ok('a user entry adds a new language',
   commandFor('/tmp/a.qqq', { qqq: 'qq "${file}"' }) === 'qq "/tmp/a.qqq"');
ok('overrides show up in the known list', knownExtensions({ qqq: 'x' }).includes('qqq'));

const exp = expand('X ${file} ${dir} ${fileBasename} ${fileBasenameNoExt} ${bin}', '/home/k/demo.cpp');
ok('every placeholder is substituted', !exp.includes('${'), exp.split(' ').slice(0, 5).join(' '));
ok('${bin} lands in a temp folder', exp.split(' ').pop().startsWith(os.tmpdir()));

/* ══ 3 · real programs, really run ═══════════════════════════ */
console.log('\n— running real programs —');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vyuha-test-'));
for (const f of ['vyuha.py', 'vyuha.js', 'vyuha.hpp', 'vyuha.h']) {
  fs.copyFileSync(path.join(__dirname, '..', 'lib', f), path.join(tmp, f));
}

function have(bin) {
  return spawnSync('bash', ['-lc', 'command -v ' + bin], { encoding: 'utf8' }).status === 0;
}

/** Write a program, run it through the real command table, parse its frames. */
function runProgram(name, source, needs) {
  const file = path.join(tmp, name);
  fs.writeFileSync(file, source);
  const cmd = commandFor(file, {});
  if (!cmd) { ok('command for ' + name, false, 'no runner'); return; }
  if (!have(needs)) { console.log('SKIP ' + name + '  (' + needs + ' is not installed here)'); return; }
  let output;
  try {
    output = execSync(cmd, { cwd: tmp, encoding: 'utf8', timeout: 60000, stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (e) {
    ok('run ' + name, false, (e.stderr || e.message || '').toString().split('\n')[0]);
    return;
  }
  const lines = output.split('\n');
  const frames = [];
  const errs = [];
  for (const line of lines) {
    const r = parseLine(line);
    if (r === null) continue;
    if ('error' in r) { errs.push(r.error); continue; }
    frames.push(r.payload);
  }
  ok('run ' + name, frames.length > 0 && errs.length === 0,
     frames.length + ' frames' + (errs.length ? ', ' + errs.length + ' bad lines' : ''));
  if (frames.length) {
    const f = frames[0];
    ok('  ' + name + ' frames are usable',
       f.type === 'ds' && f.frame.nodes.length > 0,
       f.type === 'ds' ? f.frame.kind + ' / ' + f.frame.nodes.length + ' nodes' : f.type);
  }
}

runProgram('demo.py', [
  'from vyuha import array, tree, graph, linked_list, matrix, stack, queue',
  'a = [5, 3, 8]',
  'array(a, active=[1], title="sort", note="compare")',
  'linked_list([1, 2, 3], title="list")',
  'stack([1, 2], title="stack")',
  'queue([3, 4], title="queue")',
  'matrix([[1, 2], [3, 4]], title="grid")',
  'tree({"value": 5, "left": {"value": 3}, "right": {"value": 8}}, title="bst")',
  'graph({"a": ["b"], "b": [("c", 4)]}, active=["a"], title="graph")',
  'print("ordinary output should pass straight through")'
].join('\n'), 'python3');

runProgram('demo.js', [
  "const v = require('./vyuha');",
  "v.array([5, 3, 8], { active: [1], title: 'sort' });",
  "v.linkedList([1, 2, 3], { title: 'list' });",
  "v.tree({ value: 5, left: { value: 3 } }, { title: 'bst' });",
  "v.graph({ a: ['b'] }, { title: 'graph' });",
  "console.log('ordinary output');"
].join('\n'), 'node');

runProgram('demo.cpp', [
  '#include "vyuha.hpp"',
  '#include <vector>',
  'int main(){',
  '  std::vector<int> a; a.push_back(5); a.push_back(3); a.push_back(8);',
  '  std::vector<int> act; act.push_back(1);',
  '  vyuha::array(a, act, "sort", "compare");',
  '  vyuha::list(a, act, "list");',
  '  vyuha::stack(a, "stack");',
  '  vyuha::TreeNode r("5"); vyuha::TreeNode l("3"); r.left = &l;',
  '  vyuha::tree(&r, "bst");',
  '  std::cout << "ordinary output" << std::endl;',
  '  return 0;',
  '}'
].join('\n'), 'c++');

runProgram('demo.c', [
  '#include "vyuha.h"',
  'int main(void){',
  '  int a[3] = {5, 3, 8};',
  '  int act[1] = {1};',
  '  vyuha_array(a, 3, act, 1, "sort", "compare");',
  '  vyuha_list(a, 3, act, 1, "list", 0);',
  '  vyuha_stack(a, 3, "stack", 0);',
  '  int m[4] = {1, 2, 3, 4};',
  '  vyuha_matrix(m, 2, 2, "grid", 0);',
  '  printf("ordinary output\\n");',
  '  return 0;',
  '}'
].join('\n'), 'cc');

/* a program that prints nothing must not be treated as an error */
const quiet = path.join(tmp, 'quiet.py');
fs.writeFileSync(quiet, 'print("no frames here")\n');
if (have('python3')) {
  const outq = execSync(commandFor(quiet, {}), { cwd: tmp, encoding: 'utf8' });
  const anyFrames = outq.split('\n').some(l => parseLine(l) !== null);
  ok('a silent program yields no frames and no errors', !anyFrames);
}

/* the bundled examples still emit frames */
console.log('\n— bundled examples —');
const exDir = path.join(__dirname, '..', 'examples');
for (const name of ['bubble_sort.py', 'bst_insert.py', 'dijkstra.py', 'linked_list.js', 'stack_machine.cpp', 'binary_tree.cpp', 'sieve.go']) {
  const needs = name.endsWith('.py') ? 'python3'
    : name.endsWith('.js') ? 'node'
    : name.endsWith('.go') ? 'go'
    : 'c++';
  if (!have(needs)) { console.log('SKIP ' + name); continue; }
  fs.copyFileSync(path.join(exDir, name), path.join(tmp, name));
  try {
    const o = execSync(commandFor(path.join(tmp, name), {}), { cwd: tmp, encoding: 'utf8', timeout: 60000 });
    const n = o.split('\n').filter(l => {
      const r = parseLine(l);
      return r !== null && !('error' in r);
    }).length;
    ok('example ' + name, n > 0, n + ' frames');
    if (name === 'binary_tree.cpp') {
      ok('  binary_tree walks the tree three ways',
         /preorder  : ABDHECFIGJK/.test(o) && /inorder   : DBHEAIFCJGK/.test(o) && /postorder : DEHBIFJKGCA/.test(o));
      ok('  binary_tree emits a frame per step', n >= 40, n + ' frames');
    }
  } catch (e) {
    ok('example ' + name, false, (e.stderr || e.message).toString().split('\n')[0]);
  }
}

fs.rmSync(tmp, { recursive: true, force: true });

if (failures) {
  console.log('\nRUNNER TEST FAILED — ' + failures + ' problem(s)');
  process.exit(1);
}
console.log('\nRUNNER TEST PASSED');
