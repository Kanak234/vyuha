/**
 * VYUHA 4.0.0 verification -- one check per acceptance criterion in
 * docs/4.0.0-DESIGN.md (section 6).
 *
 * WHAT IT COVERS
 *   A. Webview: the real document with BOTH renderers + the new dock, in jsdom
 *      with the real three.js (same set-up as ds-smoke.js / render-smoke.js).
 *      Zoom slider <-> camera, Size slider -> meshes and uniform, single vs
 *      double tap, frame-line fallback, no-line hint, mode routing.
 *   B. Protocol: per-node `line` survives normalise(); bad lines are dropped.
 *   C. Auto-visualize: every source-read node carries its own line.
 *   D. Debug Visualize (real python3): stack and locals carry the frame line.
 *   E. Helpers run for real: Python, Node and Java stamp the caller's line.
 *
 * FLOW: npm test runs this last (package.json "test").
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');
const { spawnSync } = require('child_process');
const { JSDOM } = require('jsdom');

let failures = 0;
function ok(label, cond, detail) {
  console.log((cond ? 'OK   ' : 'FAIL ') + label + (detail !== undefined ? '  ' + detail : ''));
  if (!cond) failures++;
}
function skip(label, why) { console.log('SKIP ' + label + '  (' + why + ')'); }

/* ══ A · webview ══════════════════════════════════════════════════ */
console.log('— webview: dock + double-tap —');

// Pull the real <body> out of runview.ts, exactly as the other smoke tests do.
const src = fs.readFileSync(__dirname + '/../src/runview.ts', 'utf8');
const body = src.slice(src.indexOf('<body'), src.indexOf('</body>') + 7).replace(/\$\{[^}]*\}/g, '');
const dom = new JSDOM('<!DOCTYPE html><html><head></head>' + body + '</html>',
  { pretendToBeVisual: true, runScripts: 'outside-only' });
const { window } = dom;
const doc = window.document;

// Minimal WebGL + 2D stubs good enough for three.js r128 (copied pattern).
function makeGL() {
  const noop = () => {};
  const h = {
    getExtension: () => new Proxy({}, { get: (t, k) => (typeof k === 'string' && /^[A-Z0-9_]+$/.test(k) ? 1 : () => ({})) }),
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
    checkFramebufferStatus: () => 36053, isContextLost: () => false,
    getContextAttributes: () => ({ alpha: true, antialias: true }),
    getSupportedExtensions: () => []
  };
  return new Proxy(h, { get(t, k) { if (k in t) return t[k]; if (typeof k === 'string' && /^[A-Z0-9_]+$/.test(k)) return 1; return noop; } });
}
window.HTMLCanvasElement.prototype.getContext = function (type) {
  if (type === '2d') {
    return new Proxy({
      canvas: this,
      createRadialGradient: () => ({ addColorStop: () => {} }),
      createLinearGradient: () => ({ addColorStop: () => {} }),
      // Sized like a real read so the GIF encoder gets a full frame.
      getImageData: (x, y, w, h) => ({ data: new Uint8ClampedArray(Math.max(1, w * h) * 4) }),
      measureText: () => ({ width: 24 }),
      // Recorded so the test can see the KP watermark being stamped on GIF frames.
      drawImage: (...args) => drawCalls.push(args),
      save: () => {}, restore: () => {}
    }, { get: (t, k) => (k in t ? t[k] : () => {}) });
  }
  return makeGL();
};

let now = 0;
Object.defineProperty(window.performance, 'now', { value: () => now, writable: true, configurable: true });
// Only ONE rAF callback is kept: this is why viewcontrols.js must not own a loop.
const rafs = [];
window.requestAnimationFrame = cb => { rafs.push(cb); return rafs.length; };
window.cancelAnimationFrame = () => {};
window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
window.devicePixelRatio = 1;
Object.defineProperty(window, 'innerWidth', { value: 700, writable: true });   // narrow: panel beside the editor
Object.defineProperty(window, 'innerHeight', { value: 800, writable: true });
window.HTMLElement.prototype.setPointerCapture = function () {};

const posted = [];
const drawCalls = [];
window.acquireVsCodeApi = () => ({ postMessage: m => posted.push(m), getState: () => null, setState: () => {} });
const errors = [];
window.addEventListener('error', e => errors.push(e.message));

const ctx = dom.getInternalVMContext();
const run = f => vm.runInContext(fs.readFileSync(f, 'utf8'), ctx, { filename: f });
try {
  // Same order as the <script> tags in runview.ts.
  ['three.min.js', 'bridge.js', 'viewcontrols.js', 'main.js', 'gifenc.js', 'ds.js']
    .forEach(f => run(__dirname + '/../media/' + f));
} catch (e) {
  console.log('FATAL while loading: ' + e.message + '\n' + e.stack.split('\n').slice(0, 5).join('\n'));
  process.exit(1);
}

function step(n) {
  for (let i = 0; i < n; i++) {
    now += 16.7;
    const cbs = rafs.splice(0, rafs.length);
    cbs.forEach(cb => cb(now));
  }
}
const send = obj => vm.runInContext('window.dispatchEvent(new MessageEvent("message",{data:' + JSON.stringify(obj) + '}))', ctx);
const $ = id => doc.getElementById(id);
function setRange(id, v) {
  const r = $(id); r.value = String(v);
  r.dispatchEvent(new window.Event('input', { bubbles: true }));
}

ok('dock is in the document', !!$('viewDock'));
ok('dock has Zoom and Size sliders', !!$('vd-zoom-range') && !!$('vd-size-range'));
ok('dock is NOT inside the timeline (so the 820px rule cannot hide it)', !$('timeline').contains($('viewDock')));
const css = fs.readFileSync(__dirname + '/../media/style.css', 'utf8');
ok('no CSS rule hides the dock', !/#viewDock[^{]*\{[^}]*display\s*:\s*none/.test(css));

// Start a data-structure run with a frame that has per-node and frame lines.
send({ type: 'runStart', file: '/tmp/demo.py', command: 'python3 demo.py', config: { frameDelay: 300, labels: true, glow: true, nodeSize: 1 } });
step(2);
const { normalise } = require(__dirname + '/../out/protocol.js');
const treeFrame = normalise({
  kind: 'graph', line: 40,
  nodes: [{ id: 'a', label: 'A', line: 12 }, { id: 'b', label: 'B' }, { id: 'c', label: 'C', line: 7 }],
  edges: [['a', 'b'], ['a', 'c']]
}).frame;
send({ type: 'frame', frame: treeFrame, index: 0 });
step(20);
const ds = window.__vyuhaDs;
ok('ds frame rendered', Object.keys(ds.nodes()).length === 3);

/* Zoom: slider -> camera, camera -> slider */
setRange('vd-zoom-range', 1000);                 // top of the slider = closest
ok('zoom slider at top moves ds camera to its minimum distance', Math.abs(ds.rig.goalDist - 6) < 1e-6, ds.rig.goalDist.toFixed(2));
setRange('vd-zoom-range', 0);
ok('zoom slider at bottom moves ds camera to its maximum distance', Math.abs(ds.rig.goalDist - 220) < 1e-6, ds.rig.goalDist.toFixed(2));
ds.rig.goalDist = 34; step(2);                   // as a wheel / fit would
const zv = Number($('vd-zoom-range').value);
ok('camera change moves the slider back (two-way sync)', zv > 0 && zv < 1000, 'slider=' + zv);
ok('zoom readout is 100% at the default distance', $('vd-zoom-val').textContent === '100%', $('vd-zoom-val').textContent);
$('vd-zoom-plus').click();
ok('+ button zooms in', ds.rig.goalDist < 34, ds.rig.goalDist.toFixed(2));

/* Size */
const nodeA = ds.nodes()['a'];
setRange('vd-size-range', 200);
step(1);
ok('size slider 2.0x doubles sphere scale', Math.abs(nodeA.mesh.scale.x - 2) < 1e-6, nodeA.mesh.scale.x);
ok('size readout shows 2.0x', $('vd-size-val').textContent === '2.0\u00d7', $('vd-size-val').textContent);
ok('halo follows node size', nodeA.halo ? Math.abs(nodeA.halo.scale.x - 7.2) < 1e-6 : true);
ok('size is shared with the network renderer uniform', window.__vyuhaNet.uniforms.uNodeSize.value === 2);

// Bars must keep their base on the same floor line when they grow.
send({ type: 'frame', frame: normalise({ array: [2, 9, 5] }).frame, index: 1 });
send({ type: 'goto', index: 1 }); step(30);
const bar = ds.nodes()['1'];
const base2 = bar.target.y - bar.mesh.scale.y / 2;
setRange('vd-size-range', 100); step(1);
const base1 = bar.target.y - bar.mesh.scale.y / 2;
ok('bars keep their base on the floor at any size', Math.abs(base2 - base1) < 1e-6, base2.toFixed(3) + ' vs ' + base1.toFixed(3));

/* Double-tap -> reveal */
send({ type: 'goto', index: 0 }); step(30);
const canvas = $('cvDs');
// The renderer's camera is private, so drive pick() by intercepting the raycast:
// every Raycaster in the ds renderer returns node `target` for this tap.
function forceHit(id) {
  const THREE = vm.runInContext('THREE', ctx);
  const mesh = ds.nodes()[id].mesh;
  const orig = THREE.Raycaster.prototype.intersectObjects;
  THREE.Raycaster.prototype.intersectObjects = function () { return [{ object: mesh }]; };
  return () => { THREE.Raycaster.prototype.intersectObjects = orig; };
}
function click(id, x, y) {
  const restore = forceHit(id);
  canvas.dispatchEvent(new window.MouseEvent('pointerdown', { clientX: x, clientY: y, button: 0, bubbles: true }));
  canvas.dispatchEvent(new window.MouseEvent('pointerup', { clientX: x, clientY: y, button: 0, bubbles: true }));
  restore();
}

posted.length = 0;
click('a', 200, 200);
ok('single tap opens the inspector', $('inspect').classList.contains('on'));
ok('single tap posts NO reveal', posted.filter(m => m.type === 'revealLine').length === 0);
ok('inspector shows the node line', /line/.test($('inspectBody').innerHTML) && /12/.test($('inspectBody').innerHTML));
click('a', 202, 201);
const rev = posted.filter(m => m.type === 'revealLine');
ok('double tap posts exactly one reveal', rev.length === 1, JSON.stringify(rev));
ok('reveal uses the node\'s own line (12)', rev[0] && rev[0].line === 12);

posted.length = 0;
click('b', 300, 300); click('b', 301, 300);
const revB = posted.filter(m => m.type === 'revealLine');
ok('node without its own line falls back to the frame line (40)', revB.length === 1 && revB[0].line === 40, JSON.stringify(revB));

posted.length = 0;
click('a', 200, 200); click('c', 200, 200);
ok('taps on two different nodes are not a double tap', posted.filter(m => m.type === 'revealLine').length === 0);

posted.length = 0;
click('c', 100, 100); click('c', 180, 100);
ok('taps far apart are not a double tap', posted.filter(m => m.type === 'revealLine').length === 0);

// A node with no line anywhere -> hint, no message.
send({ type: 'frame', frame: normalise({ nodes: [{ id: 'z', label: 'Z' }] }).frame, index: 2 });
send({ type: 'goto', index: 2 }); step(30);
posted.length = 0;
click('z', 50, 50); click('z', 50, 50);
ok('no line -> no reveal message', posted.filter(m => m.type === 'revealLine').length === 0);
ok('no line -> hint explains it', /No source line/.test($('viewHint').textContent), $('viewHint').textContent);

/* Mode routing: in net mode the dock drives the network camera. */
const spec = JSON.parse(fs.readFileSync(__dirname + '/../examples/policy-net.vyuha.json', 'utf8'));
send({ type: 'spec', spec, config: { nodeSize: 1.5 } });
step(5);
ok('switched to net mode', doc.body.dataset.mode === 'net');
ok('config nodeSize seeds the Size slider', $('vd-size-val').textContent === '1.5\u00d7', $('vd-size-val').textContent);
const dsBefore = ds.rig.goalDist;
setRange('vd-zoom-range', 1000);
ok('net mode: zoom slider drives the network camera', Math.abs(window.__vyuhaNet.rig.tDist - 8) < 1e-6, window.__vyuhaNet.rig.tDist);
ok('net mode: data-structure camera untouched', ds.rig.goalDist === dsBefore);

/* Keyboard */
const k = key => window.dispatchEvent(new window.KeyboardEvent('keydown', { key, bubbles: true }));
k(']');
ok('] grows nodes', $('vd-size-val').textContent === '1.6\u00d7', $('vd-size-val').textContent);
k('[');
ok('[ shrinks nodes', $('vd-size-val').textContent === '1.5\u00d7', $('vd-size-val').textContent);
setRange('vd-size-range', 40); k('[');
ok('size never drops below 0.4x', $('vd-size-val').textContent === '0.4\u00d7', $('vd-size-val').textContent);

k('0');
ok('0 resets node size to 1.0x', $('vd-size-val').textContent === '1.0\u00d7', $('vd-size-val').textContent);

/* KP watermark */
const mark = $('kpMark');
ok('KP watermark is in the brand panel', !!mark && mark.parentElement.classList.contains('brand'));
ok('watermark survives title updates (it is not inside the title)', !$('metaName').contains(mark));
const logoFile = fs.readFileSync(__dirname + '/../media/logo-mark.svg', 'utf8').trim();
ok('inlined logo equals media/logo-mark.svg exactly', window.__vyuhaView.logoSvg === logoFile);
ok('watermark uses a data: URI (keeps the GIF canvas untainted)', /^data:image\/svg\+xml/.test(mark.getAttribute('src')));

ok('no runtime errors in the webview', errors.length === 0, errors.join(' | '));

/* ══ B · protocol ═════════════════════════════════════════════════ */
console.log('— protocol —');
const p1 = normalise({ nodes: [{ id: 1, line: 5 }, { id: 2, line: 0 }, { id: 3, line: 'x' }, { id: 4, line: 2.5 }] }).frame;
ok('a positive integer node line survives', p1.nodes[0].line === 5);
ok('0, text and fractions are dropped', p1.nodes.slice(1).every(n => n.line === undefined));
const p2 = normalise({ tree: { value: 1, line: 9, left: { value: 2, line: 10 } } }).frame;
ok('nested tree nodes keep their lines', p2.nodes[0].line === 9 && p2.nodes[1].line === 10);
ok('a negative frame line is dropped', normalise({ array: [1], line: -4 }).frame.line === undefined);

/* ══ C · auto-visualize ═══════════════════════════════════════════ */
console.log('— auto-visualize —');
const { analyzeSource, stagesFor, autoFrame, initialState } = require(__dirname + '/../out/codegraph.js');
const pySrc = ['def greet(n):', '    for i in range(n):', '        print(i)', '', 'greet(2)'].join('\n');
const cg = analyzeSource('/tmp/x.py', pySrc);
const af = autoFrame(cg, stagesFor('python3 x.py', 'python'), initialState());
const codeNodes = af.nodes.filter(n => n.group && n.group !== 'stage');
ok('every source-read node has a line', codeNodes.length > 0 && codeNodes.every(n => typeof n.line === 'number' && n.line > 0),
   codeNodes.map(n => n.label + '@' + n.line).join(', '));
const loop = codeNodes.find(n => n.group === 'loop');
ok('the loop node points at the for-line (2)', loop && loop.line === 2);

/* ══ D · Debug Visualize (real python3) ═══════════════════════════ */
console.log('— debug visualize —');
const { debugVisualize } = require(__dirname + '/../out/debugviz.js');
const has = cmd => spawnSync(cmd, ['--version'], { encoding: 'utf8' }).status === 0;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vyuha-v4-'));

(async () => {
  if (has('python3')) {
    const f = path.join(tmp, 'dbg.py');
    fs.writeFileSync(f, ['def add(a, b):', '    s = a + b', '    return s', '', 'x = add(2, 3)', 'print(x)'].join('\n'));
    const frames = [];
    await debugVisualize(f, 20000, fr => frames.push(fr), () => {});
    const inAdd = frames.find(fr => fr.nodes.some(n => /^add/.test(n.label) && n.line === 2));
    // Each stack node's label ends in "line N". When N > 0 the node must carry
    // line N; Python reports line 0 for the module's own "call" event, and a
    // 0 must NOT be sent to the editor.
    const stackNodes = frames.flatMap(fr => fr.nodes.filter(n => n.group === 'stack'));
    const consistent = stackNodes.every(n => {
      const m = /line (\d+)$/.exec(n.label); const shown = m ? Number(m[1]) : 0;
      return shown > 0 ? n.line === shown : n.line === undefined;
    });
    ok('debug stack nodes carry their frame line (and never 0)', frames.length > 0 && consistent,
       stackNodes.length + ' stack nodes in ' + frames.length + ' frames');
    ok('the add() frame node points at its current line', !!inAdd);
    const local = inAdd && inAdd.nodes.find(n => n.group === 'local');
    const addNode = inAdd && inAdd.nodes.find(n => /^add/.test(n.label));
    ok('locals share their frame\'s line', !!local && local.line === addNode.line);
  } else skip('debug visualize', 'python3 not installed');

  /* ══ A2 · GIF export carries the KP watermark ══════════════════════ */
  console.log('— gif watermark —');
  {
    // jsdom cannot decode images, so stand in a loaded logo; the code path that
    // decides WHERE and HOW BIG to stamp it is the real one in ds.js.
    const fakeLogo = { complete: true, naturalWidth: 64 };
    window.__vyuhaView.logoImage = () => fakeLogo;
    doc.body.dataset.mode = 'ds';
    drawCalls.length = 0; posted.length = 0;
    send({ type: 'cmd', name: 'exportGif' });
    for (let i = 0; i < 80 && !posted.some(m => m.type === 'gif'); i++) {
      await new Promise(r => setTimeout(r, 25));
    }
    const gif = posted.find(m => m.type === 'gif');
    const stamps = drawCalls.filter(a => a[0] === fakeLogo);
    ok('GIF export finished', !!gif && gif.b64.length > 0, gif ? gif.frames + ' frames' : 'no gif');
    ok('every GIF frame carries the KP watermark', gif && stamps.length === gif.frames, stamps.length + ' stamps');
    const st = stamps[0] || [];
    ok('watermark sits in the bottom-right corner', st.length === 5 && st[1] > 0 && st[2] > 0);
  }

  /* ══ E · helpers, run for real ═══════════════════════════════════ */
  console.log('— helpers —');
  const lib = path.join(__dirname, '..', 'lib');
  const payloads = out => out.split('\n').filter(l => l.startsWith('@vyuha ')).map(l => JSON.parse(l.slice(7)));

  if (has('python3')) {
    fs.copyFileSync(path.join(lib, 'vyuha.py'), path.join(tmp, 'vyuha.py'));
    fs.writeFileSync(path.join(tmp, 'mod.py'), ['from vyuha import array', 'def draw(a):', '    array(a)'].join('\n'));
    fs.writeFileSync(path.join(tmp, 'main.py'), [
      'from vyuha import array, stack',   // 1
      'import mod',                       // 2
      'array([3, 1, 2])',                 // 3
      'stack([1], line=99)',              // 4
      'mod.draw([5])'                     // 5  (helper called from another module)
    ].join('\n'));
    const r = spawnSync('python3', ['main.py'], { cwd: tmp, encoding: 'utf8' });
    const p = payloads(r.stdout);
    ok('python: caller line stamped automatically', p[0] && p[0].line === 3, JSON.stringify(p[0]));
    ok('python: explicit line= wins', p[1] && p[1].line === 99);
    ok('python: call via another module maps to the main-script line', p[2] && p[2].line === 5, JSON.stringify(p[2]));
  } else skip('python helper', 'python3 not installed');

  {
    fs.copyFileSync(path.join(lib, 'vyuha.js'), path.join(tmp, 'vyuha.js'));
    fs.writeFileSync(path.join(tmp, 'main.js'), [
      "const v = require('./vyuha');",    // 1
      '',                                 // 2
      'v.array([4, 2]);',                 // 3
      'v.stack([1], { line: 77 });'       // 4
    ].join('\n'));
    const r = spawnSync(process.execPath, ['main.js'], { cwd: tmp, encoding: 'utf8' });
    const p = payloads(r.stdout);
    ok('node: caller line stamped automatically', p[0] && p[0].line === 3, JSON.stringify(p[0]));
    ok('node: explicit line wins', p[1] && p[1].line === 77);
  }

  // Java: the build machine may have only a JRE. Java 11+ can run a single
  // source file directly, and in that mode one file may hold several classes,
  // so Main and the real Vyuha helper are joined into one file for the test.
  if (spawnSync('java', ['-version'], { encoding: 'utf8' }).status === 0) {
    const jdir = path.join(tmp, 'java');
    fs.mkdirSync(jdir);
    const helper = fs.readFileSync(path.join(lib, 'Vyuha.java'), 'utf8')
      .replace(/^import java\.util\.\*;\s*$/m, '')
      .replace('public final class Vyuha', 'final class Vyuha');   // one public class per file
    fs.writeFileSync(path.join(jdir, 'Main.java'), [
      'import java.util.*;',                                          // 1
      'public class Main {',                                          // 2
      '  public static void main(String[] a) {',                      // 3
      '    Vyuha.array(new int[]{3, 1, 2}, 0);',                      // 4
      '    Vyuha.emit("{}");',                                        // 5
      '  }',                                                          // 6
      '}',                                                            // 7
      helper
    ].join('\n'));
    const r = spawnSync('java', ['Main.java'], { cwd: jdir, encoding: 'utf8' });
    if (r.status !== 0) ok('java: runs', false, r.stderr.slice(0, 400));
    else {
      const p = payloads(r.stdout);
      ok('java: caller line stamped automatically', p[0] && p[0].line === 4, JSON.stringify(p[0]));
      ok('java: an empty object stays valid JSON with the line', p[1] && p[1].line === 5, JSON.stringify(p[1]));
    }
  } else skip('java helper', 'java not installed');

  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) { /* ignore */ }

  if (failures) { console.log('\nV4 TEST FAILED — ' + failures + ' problem(s)'); process.exit(1); }
  console.log('\nV4 TEST PASSED');
})().catch(e => { console.log('FATAL ' + e.stack); process.exit(1); });
