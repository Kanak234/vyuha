
/**
 * Runs media/main.js inside jsdom with the real three.js and a stubbed WebGL
 * context. Anything the renderer touches that does not exist will throw here,
 * exactly as it would in the webview.
 */
const fs = require('fs');
const { JSDOM } = require('jsdom');

const panel = fs.readFileSync(__dirname + '/../src/runview.ts', 'utf8');
// pull the literal HTML body out of panel.ts
const start = panel.indexOf('<body');
const end = panel.indexOf('</body>') + '</body>'.length;
const body = panel.slice(start, end)
  .replace(/\$\{[^}]*\}/g, '');   // strip template substitutions (uris/nonce)

const html = '<!DOCTYPE html><html><head></head>' + body + '</html>';

const dom = new JSDOM(html, { pretendToBeVisual: true, runScripts: 'outside-only' });
const { window } = dom;

// --- stub a WebGL2 context good enough for three.js r128 -----------------
function makeGL() {
  const gl = {};
  const noop = () => {};
  const num = () => 0;
  const handlers = {
    getExtension: () => new Proxy({}, {
      get: (t, k) => {
        if (typeof k === 'string' && /^[A-Z0-9_]+$/.test(k)) return 1;
        return () => ({});
      }
    }),
    getParameter: p => {
      // MAX_TEXTURE_SIZE etc — return generous numbers
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
    getSupportedExtensions: () => [],
  };
  return new Proxy(handlers, {
    get(t, k) {
      if (k in t) return t[k];
      if (typeof k === 'string' && /^[A-Z0-9_]+$/.test(k)) return 1;  // GL constants
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
      measureText: () => ({ width: 10 }),
    }, { get: (t, k) => (k in t ? t[k] : () => {}) });
  }
  return makeGL();
};

let __now = 0;
window.__advance = ms => { __now += ms; };
// three.js Clock reads performance.now() at call time — patch the method in place
Object.defineProperty(window.performance, 'now', { value: () => __now, writable: true, configurable: true });
window.requestAnimationFrame = cb => { window.__raf = cb; return 1; };
window.cancelAnimationFrame = () => {};
window.matchMedia = q => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
window.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
window.devicePixelRatio = 1;
Object.defineProperty(window, 'innerWidth', { value: 1400, writable: true });
Object.defineProperty(window, 'innerHeight', { value: 900, writable: true });

// captured webview -> extension messages
const posted = [];
window.acquireVsCodeApi = () => ({ postMessage: m => posted.push(m), getState: () => null, setState: () => {} });

const errors = [];
window.addEventListener('error', e => errors.push('window.onerror: ' + e.message));
window.onerror = (m) => { errors.push('onerror: ' + m); };

// --- load three.js then main.js in the jsdom global scope ---------------
const vm = require('vm');
const ctx = dom.getInternalVMContext();

function run(file) {
  const code = fs.readFileSync(file, 'utf8');
  vm.runInContext(code, ctx, { filename: file });
}

let fatal = null;
try {
  run(__dirname + '/../media/three.min.js');
  vm.runInContext('console.log("THREE r" + THREE.REVISION)', ctx);
  run(__dirname + '/../media/bridge.js');
  run(__dirname + '/../media/main.js');
} catch (e) {
  fatal = e;
}

if (fatal) {
  console.log('FATAL while loading:', fatal.message);
  console.log(fatal.stack.split('\n').slice(0, 6).join('\n'));
  process.exit(1);
}

// drive a few animation frames
let frames = 0;
try {
  for (let i = 0; i < 5; i++) {
    window.__advance(16.7);
    if (window.__raf) { const cb = window.__raf; window.__raf = null; cb(1000 + i * 16); frames++; }
  }
} catch (e) {
  console.log('FATAL in frame ' + frames + ': ' + e.message);
  console.log(e.stack.split('\n').slice(0, 6).join('\n'));
  process.exit(1);
}

console.log('frames driven:', frames);
console.log('runtime errors:', errors.length ? errors : 'none');
console.log('messages posted to extension:', JSON.stringify(posted.map(p => p.type)));

// now simulate the extension sending a real spec
const spec = JSON.parse(fs.readFileSync(__dirname + '/../examples/policy-net.vyuha.json', 'utf8'));
try {
  vm.runInContext('window.dispatchEvent(new MessageEvent("message", { data: ' +
    JSON.stringify({ type: 'spec', spec, config: { speed: 1, glow: true, autoOrbit: true, labels: true } }) +
    ' }))', ctx);
  for (let i = 0; i < 5; i++) {
    window.__advance(16.7);
    if (window.__raf) { const cb = window.__raf; window.__raf = null; cb(2000 + i * 16); }
  }
} catch (e) {
  console.log('FATAL applying spec: ' + e.message);
  console.log(e.stack.split('\n').slice(0, 6).join('\n'));
  process.exit(1);
}
console.log('after spec — errors:', errors.length ? errors : 'none');
console.log('layers shown:', window.document.getElementById('mLayers').textContent,
            '| units:', window.document.getElementById('mNodes').textContent,
            '| edges:', window.document.getElementById('mEdges').textContent);
console.log('meta name:', window.document.getElementById('metaName').textContent);
console.log('action cells:', window.document.getElementById('acts').children.length);

// ---- drive enough frames for the wave to cross and lock a decision -------
function step(n, t0) {
  for (let i = 0; i < n; i++) {
    window.__advance(16.7);
    if (window.__raf) { const cb = window.__raf; window.__raf = null; cb(t0 + i * 16.7); }
  }
}
try { step(1200, 3000); } catch (e) {
  console.log('FATAL during long run: ' + e.message);
  console.log(e.stack.split('\n').slice(0,5).join('\n')); process.exit(1);
}
console.log('after long run — errors:', errors.length ? errors : 'none');
console.log('DIAG sPass:', window.document.getElementById('sPass').textContent);
console.log('DIAG first act cell:', window.document.getElementById('acts').children[0].textContent.trim().replace(/\s+/g,' '));
const kinds = posted.map(p => p.type);
console.log('posted kinds:', JSON.stringify([...new Set(kinds)]));
const dec = posted.filter(p => p.type === 'decision').pop();
console.log('decision posted:', dec ? (dec.action + ' @ ' + dec.confidence.toFixed(3)) : 'NONE');
const acts = posted.filter(p => p.type === 'activations').pop();
console.log('activation keys:', acts ? Object.keys(acts.values).length : 'NONE');
console.log('decision in DOM:', window.document.getElementById('decision').textContent);
console.log('status sub:', window.document.getElementById('decisionSub').textContent);
console.log('stats fps/draws:', window.document.getElementById('sFps').textContent, '/',
            window.document.getElementById('sCalls').textContent);

// ---- exercise every inbound message -------------------------------------
function sendIn(obj, label) {
  try {
    vm.runInContext('window.dispatchEvent(new MessageEvent("message",{data:' + JSON.stringify(obj) + '}))', ctx);
    step(3, 60000);
    console.log('OK   ' + label);
  } catch (e) { console.log('FAIL ' + label + ' -> ' + e.message); }
}
sendIn({ type: 'focus', layer: 3, unit: -1 }, 'focus layer');
sendIn({ type: 'focus', layer: 2, unit: 4 }, 'focus unit');
sendIn({ type: 'config', config: { speed: 2.5, glow: false, autoOrbit: false, labels: false } }, 'config');
sendIn({ type: 'cmd', name: 'newInput' }, 'cmd newInput');
sendIn({ type: 'cmd', name: 'trace' }, 'cmd trace');
sendIn({ type: 'cmd', name: 'run' }, 'cmd run (pause)');
sendIn({ type: 'cmd', name: 'run' }, 'cmd run (resume)');
sendIn({ type: 'cmd', name: 'export' }, 'cmd export');
sendIn({ type: 'trace', trace: { input: [0.2,0.9,0.1,0.4,0.7,0.3,0.5,0.8] } }, 'trace input vector');
sendIn({ type: 'invalid', message: 'test message' }, 'invalid overlay');

const exp = posted.filter(p => p.type === 'export').pop();
console.log('export payload keys:', exp ? Object.keys(exp.payload).join(',') : 'NONE');
if (exp) {
  console.log('  decision:', exp.payload.decision.action, '| probs:', exp.payload.decision.probabilities.length,
              '| path:', exp.payload.path ? exp.payload.path.units.length + ' units' : 'null');
}
console.log('config applied — speed label:', window.document.getElementById('vSpeed').textContent);
console.log('final errors:', errors.length ? errors : 'none');

// ---- second spec, to prove rebuild works --------------------------------
const spec2 = JSON.parse(fs.readFileSync(__dirname + '/../examples/wide-mlp.vyuha.json', 'utf8'));
sendIn({ type: 'spec', spec: spec2, config: { speed: 1, glow: true, autoOrbit: true, labels: true } }, 'rebuild with second spec');
step(600, 90000);
console.log('rebuild ->', window.document.getElementById('metaName').textContent,
            '| units:', window.document.getElementById('mNodes').textContent,
            '| cells:', window.document.getElementById('acts').children.length);
console.log('errors after rebuild:', errors.length ? errors : 'none');


const failed = errors.length > 0;
console.log(failed ? 'SMOKE TEST FAILED' : 'SMOKE TEST PASSED');
process.exit(failed ? 1 : 0);
