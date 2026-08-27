/**
 * Runs media/ds.js inside jsdom with the real three.js and a stubbed WebGL
 * context, then feeds it frames exactly as the extension would. Anything the
 * renderer touches that does not exist throws here rather than in the webview.
 */
const fs = require('fs');
const vm = require('vm');
const { JSDOM } = require('jsdom');

const src = fs.readFileSync(__dirname + '/../src/runview.ts', 'utf8');
const start = src.indexOf('<body');
const end = src.indexOf('</body>') + '</body>'.length;
const body = src.slice(start, end).replace(/\$\{[^}]*\}/g, '');
const html = '<!DOCTYPE html><html><head></head>' + body + '</html>';

const dom = new JSDOM(html, { pretendToBeVisual: true, runScripts: 'outside-only' });
const { window } = dom;

/* ── a WebGL2 context good enough for three.js r128 ─────────── */
function makeGL() {
  const noop = () => {};
  const handlers = {
    getExtension: () => new Proxy({}, {
      get: (t, k) => (typeof k === 'string' && /^[A-Z0-9_]+$/.test(k) ? 1 : () => ({}))
    }),
    getParameter: p => {
      if (p === 3379 || p === 34024 || p === 34076) return 16384;
      if (p === 34930 || p === 35660 || p === 35661) return 32;
      if (p === 36347 || p === 36348) return 1024;
      if (p === 7938) return 'WebGL 2.0';
      return 8;
    },
    getShaderPrecisionFormat: () => ({ precision: 23, rangeMin: 127, rangeMax: 127 }),
    createShader: () => ({}), createProgram: () => ({}), createBuffer: () => ({}),
    createTexture: () => ({}), createFramebuffer: () => ({}), createRenderbuffer: () => ({}),
    createVertexArray: () => ({}),
    getShaderParameter: () => true, getProgramParameter: () => true,
    getShaderInfoLog: () => '', getProgramInfoLog: () => '',
    getUniformLocation: () => ({}), getAttribLocation: () => 0,
    getActiveUniform: () => ({ name: 'u', type: 0, size: 1 }),
    getActiveAttrib: () => ({ name: 'a', type: 0, size: 1 }),
    checkFramebufferStatus: () => 36053,
    isContextLost: () => false,
    getContextAttributes: () => ({ alpha: true, antialias: true }),
    getSupportedExtensions: () => []
  };
  return new Proxy(handlers, {
    get(t, k) {
      if (k in t) return t[k];
      if (typeof k === 'string' && /^[A-Z0-9_]+$/.test(k)) return 1;
      return noop;
    }
  });
}

window.HTMLCanvasElement.prototype.getContext = function (type) {
  if (type === '2d') {
    return new Proxy({
      canvas: this,
      createRadialGradient: () => ({ addColorStop: () => {} }),
      getImageData: () => ({ data: new Uint8ClampedArray(4) }),
      measureText: () => ({ width: 24 })
    }, { get: (t, k) => (k in t ? t[k] : () => {}) });
  }
  return makeGL();
};

let __now = 0;
window.__advance = ms => { __now += ms; };
Object.defineProperty(window.performance, 'now', { value: () => __now, writable: true, configurable: true });
window.requestAnimationFrame = cb => { window.__raf = cb; return 1; };
window.cancelAnimationFrame = () => {};
window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
window.devicePixelRatio = 1;
Object.defineProperty(window, 'innerWidth', { value: 1400, writable: true });
Object.defineProperty(window, 'innerHeight', { value: 900, writable: true });

const posted = [];
window.acquireVsCodeApi = () => ({ postMessage: m => posted.push(m), getState: () => null, setState: () => {} });

const errors = [];
window.addEventListener('error', e => errors.push('window.onerror: ' + e.message));
window.onerror = m => { errors.push('onerror: ' + m); };

const ctx = dom.getInternalVMContext();
function run(file) {
  vm.runInContext(fs.readFileSync(file, 'utf8'), ctx, { filename: file });
}

let failures = 0;
function ok(label, cond, detail) {
  console.log((cond ? 'OK   ' : 'FAIL ') + label + (detail !== undefined ? '  ' + detail : ''));
  if (!cond) failures++;
}

try {
  run(__dirname + '/../media/three.min.js');
  run(__dirname + '/../media/bridge.js');
  run(__dirname + '/../media/ds.js');
} catch (e) {
  console.log('FATAL while loading:', e.message);
  console.log(e.stack.split('\n').slice(0, 6).join('\n'));
  process.exit(1);
}
console.log('THREE r' + vm.runInContext('THREE.REVISION', ctx));

window.document.body.dataset.mode = 'ds';

function step(n) {
  for (let i = 0; i < n; i++) {
    window.__advance(16.7);
    if (window.__raf) { const cb = window.__raf; window.__raf = null; cb(__now); }
  }
}

function send(obj) {
  vm.runInContext('window.dispatchEvent(new MessageEvent("message",{data:' + JSON.stringify(obj) + '}))', ctx);
}

/* ── build frames through the real protocol module ──────────── */
const { normalise } = require(__dirname + '/../out/protocol.js');

function frameOf(raw) {
  const p = normalise(raw);
  if (p.type !== 'ds') throw new Error('expected a ds payload');
  return p.frame;
}

const CASES = [
  ['array',  { array: [5, 3, 8, 1, 9, 2], active: [1, 2], title: 'bubble sort', note: 'compare' }],
  ['list',   { list: [10, 20, 30, 40], active: [0], title: 'linked list' }],
  ['stack',  { stack: [1, 2, 3], title: 'stack' }],
  ['queue',  { queue: [7, 8, 9], title: 'queue' }],
  ['matrix', { matrix: [[1, 2, 3], [4, 5, 6], [7, 8, 9]], active: ['1,1'], title: 'grid' }],
  ['tree',   { tree: { value: 50, left: { value: 30, left: { value: 20 }, right: { value: 40 } }, right: { value: 70 } }, title: 'bst' }],
  ['graph',  { adjacency: { A: [['B', 4], ['C', 2]], B: [['D', 10]], C: [['E', 3]], D: [], E: [['D', 4]] }, active: ['A'], visited: ['C'], title: 'dijkstra' }]
];

/* ── a run start clears the view and shows the waiting state ── */
try {
  send({ type: 'runStart', file: '/tmp/demo.py', command: 'python3 demo.py', config: { frameDelay: 300, labels: true, glow: true } });
  step(3);
} catch (e) {
  console.log('FATAL on runStart: ' + e.message);
  console.log(e.stack.split('\n').slice(0, 5).join('\n'));
  process.exit(1);
}
ok('runStart shows the waiting panel', window.document.getElementById('waiting').classList.contains('on'));
ok('runStart switched the body into ds mode', window.document.body.dataset.mode === 'ds');

/* ── every layout renders without throwing ──────────────────── */
let index = 0;
for (const [kind, raw] of CASES) {
  let frame;
  try {
    frame = frameOf(raw);
  } catch (e) {
    ok('normalise ' + kind, false, e.message);
    continue;
  }
  ok('normalise ' + kind, frame.kind === kind, frame.nodes.length + ' nodes / ' + frame.edges.length + ' edges');
  try {
    send({ type: 'frame', frame, index: index++ });
    step(6);
    const nodes = window.__vyuhaDs.nodes();
    ok('render ' + kind, Object.keys(nodes).length === frame.nodes.length,
       Object.keys(nodes).length + ' objects in the scene');
  } catch (e) {
    ok('render ' + kind, false, e.message + ' | ' + e.stack.split('\n')[1]);
  }
}

/* ── the frames VYUHA draws by itself, with no help from the program ── */
{
  const fsx = require('fs');
  const osx = require('os');
  const pathx = require('path');
  const { analyzeSource, stagesFor, autoFrame, initialState } = require(__dirname + '/../out/codegraph.js');

  const src = [
    '#include <iostream>',
    'using namespace std;',
    'void greet(int n) {',
    '    for (int i = 0; i < n; i++) {',
    '        cout << "hello " << i << endl;',
    '    }',
    '}',
    'int main() {',
    '    greet(3);',
    '    cout << "done" << endl;',
    '    return 0;',
    '}'
  ].join('\n');
  const file = pathx.join(osx.tmpdir(), 'vyuha-ds-auto.cpp');
  fsx.writeFileSync(file, src);

  const cg = analyzeSource(file, src);
  const stages = stagesFor('c++ -O2 x.cpp -o bin && bin', 'c');
  const st = initialState();

  // The same sequence a real run produces: compile, then run, then output.
  const script = [
    () => { st.stages['s:src'] = 'done'; st.stages['s:compile'] = 'active'; },
    () => { st.stages['s:compile'] = 'done'; st.stages['s:link'] = 'done'; st.stages['s:run'] = 'active'; st.code[cg.entry] = 'active'; },
    () => { st.outCount = 1; st.stages['s:out'] = 'active'; if (cg.outputs[0]) st.code[cg.outputs[0]] = 'active'; },
    () => { st.outCount = 2; if (cg.outputs[0]) st.code[cg.outputs[0]] = 'visited'; if (cg.outputs[1]) st.code[cg.outputs[1]] = 'active'; },
    () => { Object.keys(st.stages).forEach(k => (st.stages[k] = 'done')); Object.keys(st.code).forEach(k => (st.code[k] = 'done')); }
  ];

  let autoOk = true, detail = '';
  const idSets = [];
  script.forEach((mutate, i) => {
    mutate();
    const frame = autoFrame(cg, stages, st);
    idSets.push(frame.nodes.map(n => n.id).join('|'));
    try {
      send({ type: 'frame', frame, index: index++ });
      step(6);
      const nodes = window.__vyuhaDs.nodes();
      if (Object.keys(nodes).length !== frame.nodes.length) {
        autoOk = false;
        detail = 'frame ' + i + ': ' + Object.keys(nodes).length + ' drawn of ' + frame.nodes.length;
      }
    } catch (e) {
      autoOk = false;
      detail = 'frame ' + i + ': ' + e.message;
    }
  });
  ok('a source-read program renders across all its stages', autoOk, detail || idSets.length + ' frames');
  ok('the node set never changes, so the layout cannot jump',
     new Set(idSets).size === 1, new Set(idSets).size + ' distinct node sets');
  try { fsx.unlinkSync(file); } catch (e) {}
}

ok('waiting panel hidden once frames arrive', !window.document.getElementById('waiting').classList.contains('on'));
ok('meta counts updated', window.document.getElementById('mNodes').textContent !== '0',
   'nodes=' + window.document.getElementById('mNodes').textContent);
ok('caption shows the frame title', window.document.getElementById('capTitle').textContent.length > 0,
   '"' + window.document.getElementById('capTitle').textContent + '"');
ok('frame counter matches', window.document.getElementById('tCount').textContent === index + ' / ' + index,
   window.document.getElementById('tCount').textContent);

/* ── the timeline ───────────────────────────────────────────── */
try {
  send({ type: 'runEnd', code: 0, elapsedMs: 1234, autoPlay: true, total: index });
  step(4);
  ok('runEnd rewound to the first frame', window.document.getElementById('tCount').textContent === '1 / ' + index,
     window.document.getElementById('tCount').textContent);
  ok('autoPlay started playback', window.document.getElementById('tPlay').textContent === 'Pause');

  // Hold is 300ms, so ~20 frames of 16.7ms should advance the timeline.
  step(25);
  ok('playback advanced', window.document.getElementById('tCount').textContent !== '1 / ' + CASES.length,
     window.document.getElementById('tCount').textContent);

  window.document.getElementById('tNext').click(); step(2);
  window.document.getElementById('tPrev').click(); step(2);
  ok('step buttons work and pause playback', window.document.getElementById('tPlay').textContent === 'Play');

  send({ type: 'goto', index: 0 }); step(2);
  ok('goto jumps to a frame', window.document.getElementById('tCount').textContent === '1 / ' + index,
     window.document.getElementById('tCount').textContent);

  window.document.getElementById('tLabels').click(); step(1);
  window.document.getElementById('tGlow').click(); step(2);
  window.document.getElementById('tReset').click(); step(2);
  ok('view toggles do not throw', true);
} catch (e) {
  ok('timeline', false, e.message + ' | ' + e.stack.split('\n')[1]);
}

/* ── export and warnings ────────────────────────────────────── */
try {
  send({ type: 'cmd', name: 'export' }); step(1);
  const ex = posted.filter(p => p.type === 'export').pop();
  ok('export produced a payload', !!ex && Array.isArray(ex.payload.frames),
     ex ? ex.payload.frames.length + ' frames' : 'none');
  send({ type: 'warn', message: 'a broken @vyuha line' }); step(1);
  ok('warning overlay shown', window.document.getElementById('invalid').classList.contains('on'));
  send({ type: 'config', config: { frameDelay: 900, labels: true, glow: true } }); step(1);
  ok('config applied', window.document.getElementById('tSpeedV').textContent === '900ms',
     window.document.getElementById('tSpeedV').textContent);
} catch (e) {
  ok('messages', false, e.message);
}

/* ── a program that prints nothing ──────────────────────────── */
try {
  send({ type: 'runStart', file: '/tmp/quiet.py', command: 'python3 quiet.py', config: {} });
  step(2);
  send({ type: 'runEnd', code: 0, elapsedMs: 40, autoPlay: true, total: 0 });
  step(2);
  ok('silent program falls back to the waiting panel',
     window.document.getElementById('waiting').classList.contains('on'));
} catch (e) {
  ok('silent program', false, e.message);
}

/* ── a network spec routes to the other renderer ────────────── */
try {
  const netPayload = normalise({ type: 'net', layers: [{ id: 'in', name: 'Input', kind: 'input', n: 4 }] });
  ok('a net payload is recognised', netPayload.type === 'net');
} catch (e) {
  ok('net payload', false, e.message);
}

console.log('\nruntime errors:', errors.length ? errors : 'none');
if (errors.length) failures += errors.length;

if (failures) {
  console.log('\nDS SMOKE TEST FAILED — ' + failures + ' problem(s)');
  process.exit(1);
}
console.log('\nDS SMOKE TEST PASSED');
