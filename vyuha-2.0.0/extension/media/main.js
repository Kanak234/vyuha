(function () {
  'use strict';

  /* The bridge owns the single acquireVsCodeApi() handle for this document. */
  const bridge = window.__vyuha;
  const send = m => { if (bridge) bridge.postMessage(m); };
  const MODE = 'net';
  const awake = () => !bridge || bridge.isActive(MODE);

  if (typeof THREE === 'undefined') { document.getElementById('fail').style.display = 'grid'; return; }

  /* ══════════════════════════════════════════════════════════
     0 · CONSTANTS
     ══════════════════════════════════════════════════════════ */
  const REDUCED = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const COL = {
    input:   0x38e8ff,
    dense:   0x6aa8ff,
    attn:    0xff54cf,
    norm:    0x8fa6c4,
    ffn:     0x35f0a8,
    relu:    0x7bf6c9,
    output:  0xffc46b,
    posW:    0x35f0a8,
    negW:    0xff54cf
  };
  const KIND_LABEL = {
    input: 'input', dense: 'projection', attn: 'attention',
    norm: 'residual + norm', ffn: 'feed forward', relu: 'hidden · relu', output: 'policy head'
  };

  const ACTIONS = ['Go to food', 'Eat', 'Hide', 'Flee', 'Idle', 'Sleep'];

  const LAYER_GAP = 6.2;
  const EDGE_SAMPLES = 16;

  /* ══════════════════════════════════════════════════════════
     1 · DATA SOURCE
     ---------------------------------------------------------
     Everything downstream reads a plain JSON spec, so the mock
     generator can be swapped for a real endpoint without
     touching the renderer.

         {
           meta:   { name, note },
           layers: [ { id, name, kind, n, labels?, residualFrom? } ]
         }

     To drive this from a real model, replace DataSource.spec()
     with a fetch that returns the same shape, e.g.

         DataSource.spec = () =>
           fetch('http://127.0.0.1:8000/graph').then(r => r.json());

     Weights are derived from spec.seed, so the same spec always
     produces the same network — traces stay reproducible.
     ══════════════════════════════════════════════════════════ */
  const FALLBACK = {
    spec() {
      return {
        meta: { name: 'policy-net', note: '3 encoder blocks · 6-action policy head' },
        seed: 20260826,
        layers: [
          { id: 'tok',  name: 'Token input',      kind: 'input',  n: 8 },
          { id: 'emb',  name: 'Embedding',        kind: 'dense',  n: 14 },

          { id: 'a1',   name: 'Attention · 01',   kind: 'attn',   n: 12 },
          { id: 'n1',   name: 'Add & norm',       kind: 'norm',   n: 8, residualFrom: 'emb' },
          { id: 'f1',   name: 'Feed forward · 01',kind: 'ffn',    n: 16 },

          { id: 'a2',   name: 'Attention · 02',   kind: 'attn',   n: 12 },
          { id: 'n2',   name: 'Add & norm',       kind: 'norm',   n: 8, residualFrom: 'f1' },
          { id: 'f2',   name: 'Feed forward · 02',kind: 'ffn',    n: 16 },

          { id: 'a3',   name: 'Attention · 03',   kind: 'attn',   n: 12 },
          { id: 'n3',   name: 'Add & norm',       kind: 'norm',   n: 8, residualFrom: 'f2' },
          { id: 'f3',   name: 'Feed forward · 03',kind: 'ffn',    n: 16 },

          { id: 'h1',   name: 'Hidden · relu',    kind: 'relu',   n: 20 },
          { id: 'h2',   name: 'Hidden · relu',    kind: 'relu',   n: 12 },
          { id: 'out',  name: 'Policy head',      kind: 'output', n: 6, labels: ACTIONS }
        ]
      };
    }
  };

  /* ══════════════════════════════════════════════════════════
     2 · MATH HELPERS
     ══════════════════════════════════════════════════════════ */
  function mulberry32(a) {
    return function () {
      a |= 0; a = a + 0x6D2B79F5 | 0;
      let t = Math.imul(a ^ a >>> 15, 1 | a);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }
  function gauss(rnd) {
    let u = 0, v = 0;
    while (u === 0) u = rnd();
    while (v === 0) v = rnd();
    const g = Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
    return Math.max(-2.4, Math.min(2.4, g));
  }
  const clamp = (v, a, b) => v < a ? a : (v > b ? b : v);
  const easeOut = t => 1 - Math.pow(1 - t, 3);
  const lerp = (a, b, t) => a + (b - a) * t;

  /* ══════════════════════════════════════════════════════════
     3 · COMPILE SPEC → NETWORK
     ══════════════════════════════════════════════════════════ */
  function compile(spec) {
    const rnd = mulberry32(spec.seed || 1);
    const L = spec.layers.length;
    const net = {
      spec, layers: spec.layers, L,
      nodes: [], edges: [], layerNodes: [], layerRadius: [], layerX: [],
      inEdges: [], outEdges: []
    };

    const GA = Math.PI * (3 - Math.sqrt(5));
    const xOffset = -(L - 1) * LAYER_GAP / 2;

    spec.layers.forEach((ly, li) => {
      const n = ly.n;
      const ring = ly.kind === 'output' || ly.kind === 'input';
      const R = ring ? 1.55 + n * 0.42 : 1.9 + Math.sqrt(n) * 0.95;
      const x = xOffset + li * LAYER_GAP;
      net.layerRadius.push(R);
      net.layerX.push(x);
      const ids = [];

      for (let i = 0; i < n; i++) {
        let r, a;
        if (ring) { r = R; a = (i / n) * Math.PI * 2 - Math.PI / 2; }
        else { r = R * Math.sqrt((i + 0.55) / n); a = i * GA; }
        const idx = net.nodes.length;
        net.nodes.push({
          i: idx, li, ni: i, kind: ly.kind,
          label: (ly.labels && ly.labels[i]) || (ly.id + '·' + String(i).padStart(2, '0')),
          layerName: ly.name,
          x: x + (rnd() - 0.5) * 0.5,
          y: r * Math.cos(a),
          z: r * Math.sin(a),
          color: COL[ly.kind] || COL.dense,
          bias: gauss(rnd) * 0.22,
          act: 0, raw: 0
        });
        ids.push(idx);
      }
      net.layerNodes.push(ids);
    });

    // ── connections ────────────────────────────────────────
    const idIndex = {};
    spec.layers.forEach((ly, li) => { idIndex[ly.id] = li; });

    function connect(srcLi, dstLi, kMin, kMax, scale) {
      const A = net.layerNodes[srcLi], B = net.layerNodes[dstLi];
      const touched = new Set();
      for (let j = 0; j < B.length; j++) {
        const k = kMin + Math.floor(rnd() * (kMax - kMin + 1));
        const picks = new Set();
        picks.add(Math.min(A.length - 1, Math.floor(j * A.length / B.length)));
        let guard = 0;
        while (picks.size < k && guard++ < 40) picks.add(Math.floor(rnd() * A.length));
        picks.forEach(i => {
          touched.add(i);
          net.edges.push({ s: A[i], t: B[j], w: gauss(rnd) * scale, span: dstLi - srcLi });
        });
      }
      for (let i = 0; i < A.length; i++) {
        if (!touched.has(i)) net.edges.push({ s: A[i], t: B[Math.floor(rnd() * B.length)], w: gauss(rnd) * scale, span: dstLi - srcLi });
      }
    }

    for (let li = 1; li < L; li++) connect(li - 1, li, 3, 5, 0.8);

    // residual / skip connections — these are the long outer arcs
    spec.layers.forEach((ly, li) => {
      if (!ly.residualFrom) return;
      const from = idIndex[ly.residualFrom];
      if (from === undefined || from >= li) return;
      const A = net.layerNodes[from], B = net.layerNodes[li];
      for (let j = 0; j < B.length; j++) {
        const i = Math.min(A.length - 1, Math.floor(j * A.length / B.length));
        net.edges.push({ s: A[i], t: B[j], w: 0.55 + rnd() * 0.35, span: li - from, residual: true });
      }
    });

    net.nodes.forEach(() => { net.inEdges.push([]); net.outEdges.push([]); });
    net.edges.forEach((e, i) => { net.inEdges[e.t].push(i); net.outEdges[e.s].push(i); });

    return net;
  }

  /* ══════════════════════════════════════════════════════════
     4 · FORWARD PASS  (a real one — not a fake animation)
     ══════════════════════════════════════════════════════════ */
  function forward(net, input) {
    const N = net.nodes.length;
    const raw = new Float32Array(N);
    const act = new Float32Array(N);

    net.layerNodes[0].forEach((id, i) => { raw[id] = input[i]; act[id] = input[i]; });

    for (let li = 1; li < net.L; li++) {
      const ids = net.layerNodes[li];
      const kind = net.layers[li].kind;
      let peak = 1e-6;

      for (const id of ids) {
        let s = net.nodes[id].bias;
        for (const ei of net.inEdges[id]) {
          const e = net.edges[ei];
          s += e.w * act[e.s];
        }
        raw[id] = s;
        let v;
        if (kind === 'relu' || kind === 'ffn') v = Math.max(0, s);
        else if (kind === 'norm') v = Math.abs(Math.tanh(s));
        else v = Math.tanh(s) * 0.5 + 0.5;
        act[id] = v;
        if (v > peak) peak = v;
      }
      // layer-wise normalisation keeps the visual range readable
      if (kind !== 'output') for (const id of ids) act[id] = clamp(act[id] / peak, 0, 1);
    }

    // softmax over the policy head
    const outIds = net.layerNodes[net.L - 1];
    let max = -Infinity;
    outIds.forEach(id => { if (raw[id] > max) max = raw[id]; });
    let sum = 0;
    const probs = outIds.map(id => { const e = Math.exp((raw[id] - max) * 1.35); sum += e; return e; });
    for (let i = 0; i < probs.length; i++) probs[i] /= sum;
    outIds.forEach((id, i) => { act[id] = probs[i] / Math.max.apply(null, probs); });

    let winner = 0;
    for (let i = 1; i < probs.length; i++) if (probs[i] > probs[winner]) winner = i;

    return { raw, act, probs, winner, winnerNode: outIds[winner] };
  }

  /* ── traceback: which path actually produced the decision ── */
  function traceback(net, pass, startNode, width, depth) {
    const nodeSet = new Set([startNode]);
    const edgeSet = new Set();
    let frontier = [startNode];

    for (let d = 0; d < depth && frontier.length; d++) {
      const next = [];
      for (const id of frontier) {
        const ins = net.inEdges[id]
          .map(ei => ({ ei, c: net.edges[ei].w * pass.act[net.edges[ei].s] }))
          .sort((p, q) => q.c - p.c)
          .slice(0, width);
        for (const { ei } of ins) {
          if (edgeSet.has(ei)) continue;
          edgeSet.add(ei);
          const s = net.edges[ei].s;
          if (!nodeSet.has(s)) { nodeSet.add(s); next.push(s); }
        }
      }
      frontier = next;
    }
    return { nodeSet, edgeSet };
  }

  /* ══════════════════════════════════════════════════════════
     5 · RENDERER
     ══════════════════════════════════════════════════════════ */
  let renderer, scene, camera, clock;
  try {
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance' });
  } catch (err) {
    document.getElementById('fail').style.display = 'grid';
    return;
  }
  if (!renderer.getContext()) { document.getElementById('fail').style.display = 'grid'; return; }

  const DPR = Math.min(window.devicePixelRatio || 1, 1.75);
  renderer.setPixelRatio(DPR);
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setClearColor(0x04070d, 1);
  renderer.autoClear = true;
  renderer.domElement.id = 'cvNet';
  document.body.appendChild(renderer.domElement);
  renderer.domElement.setAttribute('aria-label', 'Interactive 3D view of the network. Drag to orbit, scroll to zoom.');

  scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(0x04070d, 0.016);
  camera = new THREE.PerspectiveCamera(46, window.innerWidth / window.innerHeight, 0.5, 400);
  clock = new THREE.Clock();

  /* ── camera rig (hand-rolled orbit: r128 ships no controls) ── */
  const rig = {
    target: new THREE.Vector3(0, 0, 0),
    theta: -0.62, phi: 1.30, dist: 58,
    tTheta: -0.62, tPhi: 1.30, tDist: 58,
    tTarget: new THREE.Vector3(0, 0, 0),
    home() {
      this.tTheta = -0.62; this.tPhi = 1.30; this.tDist = 58; this.tTarget.set(0, 0, 0);
    },
    focusLayer(li) {
      this.tTarget.set(net.layerX[li], 0, 0);
      this.tDist = 26; this.tPhi = 1.35; this.tTheta = -0.5;
    },
    apply(dt) {
      const k = REDUCED ? 1 : 1 - Math.pow(0.0016, dt);
      this.theta = lerp(this.theta, this.tTheta, k);
      this.phi = lerp(this.phi, this.tPhi, k);
      this.dist = lerp(this.dist, this.tDist, k);
      this.target.lerp(this.tTarget, k);
      const sp = Math.sin(this.phi), cp = Math.cos(this.phi);
      camera.position.set(
        this.target.x + this.dist * sp * Math.sin(this.theta),
        this.target.y + this.dist * cp,
        this.target.z + this.dist * sp * Math.cos(this.theta)
      );
      camera.lookAt(this.target);
    }
  };

  /* ══════════════════════════════════════════════════════════
     6 · GEOMETRY BUILDERS
     ══════════════════════════════════════════════════════════ */
  let net, pass, group = null;
  let nodeMesh, glowPts, edgeMesh, ringMesh;
  let aAct, aFocus, eHi, glowAct, glowFocus;

  function glowTexture() {
    const s = 64, c = document.createElement('canvas');
    c.width = c.height = s;
    const g = c.getContext('2d');
    const grd = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
    grd.addColorStop(0.0, 'rgba(255,255,255,1)');
    grd.addColorStop(0.22, 'rgba(255,255,255,.42)');
    grd.addColorStop(0.55, 'rgba(255,255,255,.09)');
    grd.addColorStop(1.0, 'rgba(255,255,255,0)');
    g.fillStyle = grd; g.fillRect(0, 0, s, s);
    const t = new THREE.CanvasTexture(c);
    t.needsUpdate = true;
    return t;
  }
  const GLOW_TEX = glowTexture();

  const uniforms = {
    uTime:  { value: 0 },
    uWave:  { value: -1 },
    uHiOn:  { value: 0 },
    uBoot:  { value: REDUCED ? 1 : 0 },
    uGlow:  { value: GLOW_TEX },
    uScale: { value: 1 }
  };

  /* ── nodes: instanced cores ────────────────────────────── */
  const NODE_VERT = `
    attribute vec3 aColor;
    attribute float aAct;
    attribute float aFocus;   // 0 dim · 1 normal · 2 highlighted
    attribute float aLayer;
    uniform float uBoot;
    varying vec3 vColor; varying float vAct; varying float vFocus;
    varying vec3 vN; varying vec3 vV;
    void main(){
      vColor = aColor; vAct = aAct; vFocus = aFocus;
      float boot = clamp(uBoot * 14.0 - aLayer, 0.0, 1.0);
      float s = (0.55 + aAct * 0.85 + step(1.5, aFocus) * 0.5) * boot;
      vec4 mv = modelViewMatrix * instanceMatrix * vec4(position * s, 1.0);
      vN = normalize(mat3(modelViewMatrix) * mat3(instanceMatrix) * normal);
      vV = normalize(-mv.xyz);
      gl_Position = projectionMatrix * mv;
    }`;
  const NODE_FRAG = `
    varying vec3 vColor; varying float vAct; varying float vFocus;
    varying vec3 vN; varying vec3 vV;
    void main(){
      float f = pow(1.0 - max(dot(vN, vV), 0.0), 2.2);
      vec3 col = vColor * (0.22 + vAct * 1.05) + vColor * f * 1.5;
      col *= mix(0.16, 1.0, step(0.5, vFocus));
      col *= 1.0 + step(1.5, vFocus) * 1.1;
      gl_FragColor = vec4(col, 1.0);
    }`;

  /* ── nodes: additive halo sprites ──────────────────────── */
  const GLOW_VERT = `
    attribute vec3 aColor;
    attribute float aAct;
    attribute float aFocus;
    attribute float aLayer;
    attribute float aSize;
    uniform float uBoot; uniform float uScale;
    varying vec3 vColor; varying float vI;
    void main(){
      vColor = aColor;
      float boot = clamp(uBoot * 14.0 - aLayer, 0.0, 1.0);
      vI = (0.10 + aAct * 0.85) * mix(0.12, 1.0, step(0.5, aFocus)) * (1.0 + step(1.5, aFocus) * 1.4) * boot;
      vec4 mv = modelViewMatrix * vec4(position, 1.0);
      gl_PointSize = aSize * uScale * (1.0 + aAct * 1.5) * (260.0 / max(-mv.z, 0.001));
      gl_Position = projectionMatrix * mv;
    }`;
  const GLOW_FRAG = `
    uniform sampler2D uGlow;
    varying vec3 vColor; varying float vI;
    void main(){
      vec4 t = texture2D(uGlow, gl_PointCoord);
      gl_FragColor = vec4(vColor * vI * 1.5, 1.0) * t.a;
    }`;

  /* ── edges: sampled beziers with a travelling pulse ────── */
  const EDGE_VERT = `
    attribute float aT;
    attribute vec3 aColor;
    attribute float aW;
    attribute float aSeed;
    attribute float aSrc;
    attribute float aHi;
    uniform float uBoot;
    varying float vT; varying vec3 vColor; varying float vW;
    varying float vSeed; varying float vSrc; varying float vHi; varying float vBoot;
    void main(){
      vT = aT; vColor = aColor; vW = aW; vSeed = aSeed; vSrc = aSrc; vHi = aHi;
      vBoot = clamp(uBoot * 14.0 - aSrc, 0.0, 1.0);
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }`;
  const EDGE_FRAG = `
    uniform float uTime; uniform float uWave; uniform float uHiOn;
    varying float vT; varying vec3 vColor; varying float vW;
    varying float vSeed; varying float vSrc; varying float vHi; varying float vBoot;
    void main(){
      float d = (uWave - vSrc) - vT;
      float pulse = exp(-d * d * 16.0);
      float dash = smoothstep(0.87, 1.0, fract(vT * 3.0 - uTime * 0.3 + vSeed)) * 0.22 * vW;
      float a = 0.05 + 0.085 * vW + pulse * 0.62 + dash;
      a *= mix(mix(1.0, 0.10, uHiOn), 2.3, vHi);
      a *= vBoot;
      vec3 col = vColor * (1.0 + pulse * 2.4 + vHi * 1.2);
      gl_FragColor = vec4(col, a);
    }`;

  /* ── layer rings ───────────────────────────────────────── */
  const RING_VERT = `
    attribute vec3 aColor; attribute float aLayer;
    uniform float uBoot;
    varying vec3 vColor; varying float vLayer; varying float vBoot;
    void main(){
      vColor = aColor; vLayer = aLayer;
      vBoot = clamp(uBoot * 14.0 - aLayer, 0.0, 1.0);
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }`;
  const RING_FRAG = `
    uniform float uWave;
    varying vec3 vColor; varying float vLayer; varying float vBoot;
    void main(){
      float d = uWave - vLayer;
      float hot = exp(-d * d * 5.0);
      gl_FragColor = vec4(vColor * (0.35 + hot * 2.2), (0.06 + hot * 0.42) * vBoot);
    }`;

  function buildGraph(spec) {
    if (group) disposeGraph();
    net = compile(spec);
    group = new THREE.Group();
    scene.add(group);

    const N = net.nodes.length;
    const E = net.edges.length;

    /* cores */
    const coreGeo = new THREE.IcosahedronGeometry(0.34, 1);
    const nodeMat = new THREE.ShaderMaterial({
      uniforms: { uBoot: uniforms.uBoot },
      vertexShader: NODE_VERT, fragmentShader: NODE_FRAG
    });
    nodeMesh = new THREE.InstancedMesh(coreGeo, nodeMat, N);
    nodeMesh.frustumCulled = false;

    aAct = new Float32Array(N);
    aFocus = new Float32Array(N).fill(1);
    const nCol = new Float32Array(N * 3), nLay = new Float32Array(N);
    const gPos = new Float32Array(N * 3), gSize = new Float32Array(N);
    const m = new THREE.Matrix4(), c = new THREE.Color();

    net.nodes.forEach((n, i) => {
      m.makeTranslation(n.x, n.y, n.z);
      nodeMesh.setMatrixAt(i, m);
      c.setHex(n.color);
      nCol[i * 3] = c.r; nCol[i * 3 + 1] = c.g; nCol[i * 3 + 2] = c.b;
      nLay[i] = n.li;
      gPos[i * 3] = n.x; gPos[i * 3 + 1] = n.y; gPos[i * 3 + 2] = n.z;
      gSize[i] = n.kind === 'output' ? 0.16 : 0.105;
    });
    nodeMesh.instanceMatrix.needsUpdate = true;
    coreGeo.setAttribute('aColor', new THREE.InstancedBufferAttribute(nCol, 3));
    coreGeo.setAttribute('aAct', new THREE.InstancedBufferAttribute(aAct, 1));
    coreGeo.setAttribute('aFocus', new THREE.InstancedBufferAttribute(aFocus, 1));
    coreGeo.setAttribute('aLayer', new THREE.InstancedBufferAttribute(nLay, 1));
    group.add(nodeMesh);

    /* halos */
    glowAct = new Float32Array(N); glowFocus = new Float32Array(N).fill(1);
    const gGeo = new THREE.BufferGeometry();
    gGeo.setAttribute('position', new THREE.BufferAttribute(gPos, 3));
    gGeo.setAttribute('aColor', new THREE.BufferAttribute(nCol.slice(), 3));
    gGeo.setAttribute('aAct', new THREE.BufferAttribute(glowAct, 1));
    gGeo.setAttribute('aFocus', new THREE.BufferAttribute(glowFocus, 1));
    gGeo.setAttribute('aLayer', new THREE.BufferAttribute(nLay.slice(), 1));
    gGeo.setAttribute('aSize', new THREE.BufferAttribute(gSize, 1));
    glowPts = new THREE.Points(gGeo, new THREE.ShaderMaterial({
      uniforms: { uGlow: uniforms.uGlow, uBoot: uniforms.uBoot, uScale: uniforms.uScale },
      vertexShader: GLOW_VERT, fragmentShader: GLOW_FRAG,
      transparent: true, blending: THREE.AdditiveBlending, depthWrite: false
    }));
    glowPts.frustumCulled = false;
    group.add(glowPts);

    /* edges */
    const SEG = EDGE_SAMPLES - 1;
    const vCount = E * SEG * 2;
    const ePos = new Float32Array(vCount * 3);
    const eT = new Float32Array(vCount);
    const eCol = new Float32Array(vCount * 3);
    const eW = new Float32Array(vCount);
    const eSeed = new Float32Array(vCount);
    const eSrc = new Float32Array(vCount);
    eHi = new Float32Array(vCount);

    const p0 = new THREE.Vector3(), p1 = new THREE.Vector3(),
          c1 = new THREE.Vector3(), c2 = new THREE.Vector3(), pt = new THREE.Vector3();
    const cc = new THREE.Color(), cs = new THREE.Color(), ct = new THREE.Color();
    let v = 0;

    net.edges.forEach((e, ei) => {
      const A = net.nodes[e.s], B = net.nodes[e.t];
      p0.set(A.x, A.y, A.z); p1.set(B.x, B.y, B.z);
      const dx = p1.x - p0.x;
      const bow = e.residual ? 1.62 : 1.0;
      c1.set(p0.x + dx * 0.42, p0.y * bow, p0.z * bow);
      c2.set(p1.x - dx * 0.42, p1.y * bow, p1.z * bow);

      const wAbs = clamp(Math.abs(e.w) / 1.7, 0.08, 1);
      cs.setHex(e.w >= 0 ? COL.posW : COL.negW);
      ct.setHex(B.color);
      cc.copy(cs).lerp(ct, 0.34);
      const seed = (ei * 0.6180339887) % 1;

      const pts = [];
      for (let s = 0; s < EDGE_SAMPLES; s++) {
        const t = s / SEG, it = 1 - t;
        pt.set(
          it * it * it * p0.x + 3 * it * it * t * c1.x + 3 * it * t * t * c2.x + t * t * t * p1.x,
          it * it * it * p0.y + 3 * it * it * t * c1.y + 3 * it * t * t * c2.y + t * t * t * p1.y,
          it * it * it * p0.z + 3 * it * it * t * c1.z + 3 * it * t * t * c2.z + t * t * t * p1.z
        );
        pts.push(pt.clone());
      }
      for (let s = 0; s < SEG; s++) {
        for (let h = 0; h < 2; h++) {
          const q = pts[s + h], t = (s + h) / SEG;
          ePos[v * 3] = q.x; ePos[v * 3 + 1] = q.y; ePos[v * 3 + 2] = q.z;
          eCol[v * 3] = cc.r; eCol[v * 3 + 1] = cc.g; eCol[v * 3 + 2] = cc.b;
          eT[v] = t; eW[v] = wAbs; eSeed[v] = seed;
          eSrc[v] = A.li + (e.span > 1 ? (e.span - 1) * 0.5 : 0);
          v++;
        }
      }
      e.v0 = ei * SEG * 2;
      e.vN = SEG * 2;
    });

    const eGeo = new THREE.BufferGeometry();
    eGeo.setAttribute('position', new THREE.BufferAttribute(ePos, 3));
    eGeo.setAttribute('aT', new THREE.BufferAttribute(eT, 1));
    eGeo.setAttribute('aColor', new THREE.BufferAttribute(eCol, 3));
    eGeo.setAttribute('aW', new THREE.BufferAttribute(eW, 1));
    eGeo.setAttribute('aSeed', new THREE.BufferAttribute(eSeed, 1));
    eGeo.setAttribute('aSrc', new THREE.BufferAttribute(eSrc, 1));
    eGeo.setAttribute('aHi', new THREE.BufferAttribute(eHi, 1));
    edgeMesh = new THREE.LineSegments(eGeo, new THREE.ShaderMaterial({
      uniforms: {
        uTime: uniforms.uTime, uWave: uniforms.uWave,
        uHiOn: uniforms.uHiOn, uBoot: uniforms.uBoot
      },
      vertexShader: EDGE_VERT, fragmentShader: EDGE_FRAG,
      transparent: true, blending: THREE.AdditiveBlending, depthWrite: false
    }));
    edgeMesh.frustumCulled = false;
    group.add(edgeMesh);

    /* layer rings */
    const SEGR = 72;
    const rPos = [], rCol = [], rLay = [];
    net.layers.forEach((ly, li) => {
      const R = net.layerRadius[li] + 1.15, X = net.layerX[li];
      const col = new THREE.Color(COL[ly.kind] || COL.dense);
      for (let s = 0; s < SEGR; s++) {
        const a0 = (s / SEGR) * Math.PI * 2, a1 = ((s + 1) / SEGR) * Math.PI * 2;
        rPos.push(X, R * Math.cos(a0), R * Math.sin(a0), X, R * Math.cos(a1), R * Math.sin(a1));
        rCol.push(col.r, col.g, col.b, col.r, col.g, col.b);
        rLay.push(li, li);
      }
    });
    const rGeo = new THREE.BufferGeometry();
    rGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(rPos), 3));
    rGeo.setAttribute('aColor', new THREE.BufferAttribute(new Float32Array(rCol), 3));
    rGeo.setAttribute('aLayer', new THREE.BufferAttribute(new Float32Array(rLay), 1));
    ringMesh = new THREE.LineSegments(rGeo, new THREE.ShaderMaterial({
      uniforms: { uWave: uniforms.uWave, uBoot: uniforms.uBoot },
      vertexShader: RING_VERT, fragmentShader: RING_FRAG,
      transparent: true, blending: THREE.AdditiveBlending, depthWrite: false
    }));
    ringMesh.frustumCulled = false;
    group.add(ringMesh);

    buildLabels();
    buildActionCells();
    document.getElementById('mNodes').textContent = N;
    document.getElementById('mEdges').textContent = E;
    document.getElementById('mLayers').textContent = net.L;
    const meta = spec.meta || {};
    document.getElementById('metaName').textContent = meta.name || 'Inference Graph';
    document.getElementById('metaNote').textContent =
      meta.note || (net.layers.filter(l => l.kind === 'attn').length + ' encoder blocks');
  }

  function disposeGraph() {
    group.traverse(o => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) o.material.dispose();
    });
    scene.remove(group);
    group = null;
  }

  /* ══════════════════════════════════════════════════════════
     7 · DOM: layer labels + action cells
     ══════════════════════════════════════════════════════════ */
  const labelHost = document.getElementById('labels');
  let labelEls = [];

  function buildLabels() {
    labelHost.innerHTML = '';
    labelEls = net.layers.map((ly, li) => {
      const el = document.createElement('div');
      el.className = 'lbl';
      el.innerHTML = '<span class="idx">' + String(li + 1).padStart(2, '0') + '</span>' +
                     ly.name + ' <span class="idx">×' + ly.n + '</span>';
      labelHost.appendChild(el);
      return el;
    });
  }

  const actsHost = document.getElementById('acts');
  let actEls = [];

  function buildActionCells() {
    const last = net.layers[net.L - 1];
    const names = last.labels || net.layerNodes[net.L - 1].map((_, i) => 'Out ' + i);
    net.outNames = names;
    actsHost.innerHTML = '';
    actEls = names.map((name, i) => {
      const b = document.createElement('button');
      b.className = 'act';
      b.type = 'button';
      b.innerHTML = '<i class="bg"></i><span class="tag">locked</span>' +
                    '<div class="n">' + name + '</div><div class="p">0.0%</div>';
      b.addEventListener('click', () => {
        const id = net.layerNodes[net.L - 1][i];
        selectNode(id);
        traceFrom(id);
      });
      actsHost.appendChild(b);
      return { el: b, bg: b.querySelector('.bg'), p: b.querySelector('.p') };
    });
  }

  /* ══════════════════════════════════════════════════════════
     8 · POST: bright → blur → composite (vignette, grain, CA)
     ══════════════════════════════════════════════════════════ */
  const fsScene = new THREE.Scene();
  const fsCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const fsQuad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), null);
  fsScene.add(fsQuad);

  const rtOpts = { minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, format: THREE.RGBAFormat };
  let rtScene, rtA, rtB;

  const blackPixel = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1, THREE.RGBAFormat);
  blackPixel.needsUpdate = true;

  const brightMat = new THREE.ShaderMaterial({
    uniforms: { tDiffuse: { value: null }, uCut: { value: 0.42 } },
    vertexShader: 'varying vec2 vUv; void main(){ vUv=uv; gl_Position=vec4(position.xy,0.0,1.0); }',
    fragmentShader: `
      uniform sampler2D tDiffuse; uniform float uCut; varying vec2 vUv;
      void main(){
        vec3 c = texture2D(tDiffuse, vUv).rgb;
        float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
        float k = smoothstep(uCut, uCut + 0.35, l);
        gl_FragColor = vec4(c * k, 1.0);
      }`
  });

  const blurMat = new THREE.ShaderMaterial({
    uniforms: { tDiffuse: { value: null }, uDir: { value: new THREE.Vector2(1, 0) } },
    vertexShader: 'varying vec2 vUv; void main(){ vUv=uv; gl_Position=vec4(position.xy,0.0,1.0); }',
    fragmentShader: `
      uniform sampler2D tDiffuse; uniform vec2 uDir; varying vec2 vUv;
      void main(){
        vec3 s = texture2D(tDiffuse, vUv).rgb * 0.2270270270;
        s += texture2D(tDiffuse, vUv + uDir * 1.3846153846).rgb * 0.3162162162;
        s += texture2D(tDiffuse, vUv - uDir * 1.3846153846).rgb * 0.3162162162;
        s += texture2D(tDiffuse, vUv + uDir * 3.2307692308).rgb * 0.0702702703;
        s += texture2D(tDiffuse, vUv - uDir * 3.2307692308).rgb * 0.0702702703;
        gl_FragColor = vec4(s, 1.0);
      }`
  });

  const compMat = new THREE.ShaderMaterial({
    uniforms: {
      tBase: { value: null }, tBloom: { value: blackPixel },
      uStrength: { value: 1.0 }, uTime: { value: 0 }
    },
    vertexShader: 'varying vec2 vUv; void main(){ vUv=uv; gl_Position=vec4(position.xy,0.0,1.0); }',
    fragmentShader: `
      uniform sampler2D tBase; uniform sampler2D tBloom;
      uniform float uStrength; uniform float uTime;
      varying vec2 vUv;
      float hash(vec2 p){ return fract(sin(dot(p, vec2(41.3, 289.1))) * 43758.5453); }
      void main(){
        vec2 d = vUv - 0.5;
        float r = length(d);
        vec3 base;
        base.r = texture2D(tBase, vUv + d * 0.0028 * r).r;
        base.g = texture2D(tBase, vUv).g;
        base.b = texture2D(tBase, vUv - d * 0.0028 * r).b;
        vec3 col = base + texture2D(tBloom, vUv).rgb * uStrength;
        col *= smoothstep(1.15, 0.34, r);                       // vignette
        col += (hash(vUv * 512.0 + uTime) - 0.5) * 0.022;       // grain
        gl_FragColor = vec4(col, 1.0);
      }`
  });

  function sizeTargets(w, h) {
    const W = Math.max(2, Math.floor(w * DPR)), H = Math.max(2, Math.floor(h * DPR));
    const hw = Math.max(2, Math.floor(W / 2)), hh = Math.max(2, Math.floor(H / 2));
    if (!rtScene) {
      rtScene = new THREE.WebGLRenderTarget(W, H, rtOpts);
      rtA = new THREE.WebGLRenderTarget(hw, hh, rtOpts);
      rtB = new THREE.WebGLRenderTarget(hw, hh, rtOpts);
    } else {
      rtScene.setSize(W, H); rtA.setSize(hw, hh); rtB.setSize(hw, hh);
    }
  }

  function blit(mat, target) {
    fsQuad.material = mat;
    renderer.setRenderTarget(target || null);
    renderer.render(fsScene, fsCam);
    renderer.setRenderTarget(null);
  }

  /* ══════════════════════════════════════════════════════════
     9 · STATE
     ══════════════════════════════════════════════════════════ */
  const S = {
    running: true, speed: 1, wave: -0.6, holding: 0,
    labels: true, bloom: true, orbit: true,
    hover: -1, selected: -1,
    trace: null, locked: false,
    lastTrace: null
  };

  function newInput() {
    const n = net.layerNodes[0].length;
    const inp = new Array(n);
    for (let i = 0; i < n; i++) inp[i] = Math.random();
    pass = forward(net, inp);
    pass.input = inp;
    S.wave = -0.6; S.holding = 0; S.locked = false;
    clearTrace();
    railHead.classList.remove('locked');
    decisionEl.textContent = '—';
    decisionSubEl.textContent = 'signal in flight';
    actEls.forEach(a => a.el.classList.remove('win', 'locked'));
  }

  /* ── highlight plumbing ────────────────────────────────── */
  function applyFocus(nodeSet, edgeSet) {
    const N = net.nodes.length;
    if (!nodeSet) {
      for (let i = 0; i < N; i++) { aFocus[i] = 1; glowFocus[i] = 1; }
      eHi.fill(0);
      uniforms.uHiOn.value = 0;
    } else {
      for (let i = 0; i < N; i++) {
        const v = nodeSet.has(i) ? 2 : 0;
        aFocus[i] = v; glowFocus[i] = v;
      }
      eHi.fill(0);
      edgeSet.forEach(ei => {
        const e = net.edges[ei];
        for (let k = 0; k < e.vN; k++) eHi[e.v0 + k] = 1;
      });
      uniforms.uHiOn.value = 1;
    }
    nodeMesh.geometry.attributes.aFocus.needsUpdate = true;
    glowPts.geometry.attributes.aFocus.needsUpdate = true;
    edgeMesh.geometry.attributes.aHi.needsUpdate = true;
  }
  function clearTrace() { S.trace = null; applyFocus(null); }

  function traceFrom(nodeId) {
    const t = traceback(net, pass, nodeId, 3, 9);
    S.trace = t; S.lastTrace = { node: nodeId, t };
    applyFocus(t.nodeSet, t.edgeSet);
  }

  /* ── inspector ─────────────────────────────────────────── */
  const inspect = document.getElementById('inspect');
  const inspectBody = document.getElementById('inspectBody');

  function hex(c) { return '#' + c.toString(16).padStart(6, '0'); }

  function selectNode(id, quiet) {
    S.selected = id;
    const n = net.nodes[id];
    const col = hex(n.color);
    const act = pass ? pass.act[id] : 0;
    const raw = pass ? pass.raw[id] : 0;

    const ins = net.inEdges[id]
      .map(ei => ({ ei, e: net.edges[ei], c: net.edges[ei].w * (pass ? pass.act[net.edges[ei].s] : 0) }))
      .sort((a, b) => Math.abs(b.c) - Math.abs(a.c))
      .slice(0, 6);

    const maxC = ins.length ? Math.max.apply(null, ins.map(o => Math.abs(o.c))) || 1 : 1;

    let rows = ins.map(o => {
      const src = net.nodes[o.e.s];
      const pct = Math.abs(o.c) / maxC * 100;
      const cc = o.e.w >= 0 ? hex(COL.posW) : hex(COL.negW);
      const side = o.e.w >= 0 ? 'left:50%' : 'right:50%';
      return '<div class="wrow"><div><div class="src">' + src.label + '</div>' +
             '<div class="wbar"><i style="' + side + ';width:' + (pct / 2).toFixed(1) + '%;background:' + cc + '"></i></div></div>' +
             '<div class="wnum">' + (o.e.w >= 0 ? '+' : '') + o.e.w.toFixed(2) + '</div></div>';
    }).join('');
    if (!ins.length) rows = '<p class="src" style="font-family:var(--mono);font-size:10.5px;color:var(--dim);margin:0">Input unit — the signal starts here.</p>';

    const isOut = n.kind === 'output';
    const prob = isOut && pass ? pass.probs[n.ni] : null;

    inspectBody.innerHTML =
      '<p class="nodeName">' + n.label + '</p>' +
      '<p class="nodeKind" style="color:' + col + '">' + (KIND_LABEL[n.kind] || n.kind) + ' · layer ' + (n.li + 1) + '/' + net.L + '</p>' +
      '<div class="meter"><div class="lab"><span>' + (isOut ? 'probability' : 'activation') + '</span><b>' +
        (isOut ? (prob * 100).toFixed(1) + '%' : act.toFixed(3)) + '</b></div>' +
        '<div class="track"><div class="fill" style="width:' + ((isOut ? prob : act) * 100).toFixed(1) + '%;background:' + col + '"></div></div></div>' +
      '<div class="meter"><div class="lab"><span>pre-activation</span><b>' + (raw >= 0 ? '+' : '') + raw.toFixed(3) + '</b></div></div>' +
      '<div class="meter"><div class="lab"><span>fan in / fan out</span><b>' + net.inEdges[id].length + ' / ' + net.outEdges[id].length + '</b></div></div>' +
      '<p class="subhead">Strongest inputs</p>' + rows +
      '<button class="btn" id="bTraceNode" style="width:100%;margin-top:14px">Trace path from here</button>';

    const btn = document.getElementById('bTraceNode');
    if (btn) btn.addEventListener('click', () => traceFrom(id));

    inspect.classList.add('on');
    rig.tTarget.set(n.x * 0.35, n.y * 0.35, n.z * 0.35);

    if (!quiet) send({ type: 'select', layer: n.li, unit: n.ni, label: n.label, id: net.layers[n.li].id });
  }

  document.getElementById('closeInspect').addEventListener('click', () => {
    inspect.classList.remove('on');
    S.selected = -1;
    clearTrace();
  });

  /* ══════════════════════════════════════════════════════════
     10 · PICKING
     ══════════════════════════════════════════════════════════ */
  const ray = new THREE.Raycaster();
  const ptr = new THREE.Vector2(-2, -2);
  const tip = document.getElementById('tip');
  let pointerPx = { x: 0, y: 0 }, needPick = false;

  function pick() {
    if (!nodeMesh) return -1;
    ray.setFromCamera(ptr, camera);
    const hits = ray.intersectObject(nodeMesh, false);
    return hits.length ? hits[0].instanceId : -1;
  }

  function onPointerMove(ev) {
    pointerPx.x = ev.clientX; pointerPx.y = ev.clientY;
    ptr.x = (ev.clientX / window.innerWidth) * 2 - 1;
    ptr.y = -(ev.clientY / window.innerHeight) * 2 + 1;
    needPick = true;
  }

  function updateHover() {
    if (!needPick) return;
    needPick = false;
    const id = pick();
    if (id === S.hover) return;
    S.hover = id;
    if (id < 0) { tip.classList.remove('on'); renderer.domElement.style.cursor = 'grab'; return; }
    const n = net.nodes[id];
    const isOut = n.kind === 'output';
    const val = isOut && pass ? (pass.probs[n.ni] * 100).toFixed(1) + '%' : (pass ? pass.act[id].toFixed(3) : '—');
    tip.innerHTML = n.label + ' <span class="a">' + val + '</span>';
    tip.style.left = pointerPx.x + 'px';
    tip.style.top = pointerPx.y + 'px';
    tip.classList.add('on');
    renderer.domElement.style.cursor = 'pointer';
  }

  /* ══════════════════════════════════════════════════════════
     11 · CAMERA INPUT
     ══════════════════════════════════════════════════════════ */
  const cv = renderer.domElement;
  let drag = null, pinch = null, moved = 0;
  cv.style.cursor = 'grab';

  cv.addEventListener('pointerdown', e => {
    if (e.pointerType === 'touch' && pinch) return;
    cv.setPointerCapture(e.pointerId);
    drag = { x: e.clientX, y: e.clientY, pan: e.button === 2 || e.shiftKey };
    moved = 0;
    cv.style.cursor = 'grabbing';
    S.orbit = false; setToggle('bOrbit', false);
  });
  cv.addEventListener('pointermove', e => {
    onPointerMove(e);
    if (!drag) return;
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    drag.x = e.clientX; drag.y = e.clientY;
    moved += Math.abs(dx) + Math.abs(dy);
    if (drag.pan) {
      const sc = rig.dist * 0.0016;
      const right = new THREE.Vector3().setFromMatrixColumn(camera.matrix, 0);
      const up = new THREE.Vector3().setFromMatrixColumn(camera.matrix, 1);
      rig.tTarget.addScaledVector(right, -dx * sc).addScaledVector(up, dy * sc);
    } else {
      rig.tTheta -= dx * 0.0055;
      rig.tPhi = clamp(rig.tPhi - dy * 0.0055, 0.18, Math.PI - 0.18);
    }
  });
  function endDrag(e) {
    if (!drag) return;
    if (moved < 6) {
      const id = pick();
      if (id >= 0) { selectNode(id); traceFrom(id); }
      else if (S.selected < 0) clearTrace();
    }
    drag = null; cv.style.cursor = 'grab';
  }
  cv.addEventListener('pointerup', endDrag);
  cv.addEventListener('pointercancel', () => { drag = null; cv.style.cursor = 'grab'; });
  cv.addEventListener('contextmenu', e => e.preventDefault());
  cv.addEventListener('wheel', e => {
    e.preventDefault();
    rig.tDist = clamp(rig.tDist * (1 + Math.sign(e.deltaY) * 0.11), 8, 150);
  }, { passive: false });

  cv.addEventListener('touchstart', e => {
    if (e.touches.length === 2) {
      drag = null;
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      pinch = { d: Math.hypot(dx, dy), dist: rig.tDist };
    }
  }, { passive: true });
  cv.addEventListener('touchmove', e => {
    if (pinch && e.touches.length === 2) {
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      const d = Math.hypot(dx, dy);
      rig.tDist = clamp(pinch.dist * (pinch.d / Math.max(d, 1)), 8, 150);
    }
  }, { passive: true });
  cv.addEventListener('touchend', e => { if (e.touches.length < 2) pinch = null; }, { passive: true });

  /* ══════════════════════════════════════════════════════════
     12 · CONTROLS
     ══════════════════════════════════════════════════════════ */
  const railHead = document.getElementById('railHead');
  const decisionEl = document.getElementById('decision');
  const decisionSubEl = document.getElementById('decisionSub');

  function setToggle(id, on) {
    const b = document.getElementById(id);
    if (b) b.classList.toggle('on', !!on);
  }

  document.getElementById('bRun').addEventListener('click', e => {
    S.running = !S.running;
    e.currentTarget.textContent = S.running ? 'Pause' : 'Run';
    e.currentTarget.classList.toggle('on', S.running);
  });
  document.getElementById('bNew').addEventListener('click', () => newInput());
  document.getElementById('bTrace').addEventListener('click', () => {
    if (S.trace) { clearTrace(); return; }
    traceFrom(pass.winnerNode);
    selectNode(pass.winnerNode);
  });
  document.getElementById('bReset').addEventListener('click', () => rig.home());
  document.getElementById('bLabels').addEventListener('click', e => {
    S.labels = !S.labels;
    e.currentTarget.classList.toggle('on', S.labels);
    labelHost.style.display = S.labels ? '' : 'none';
  });
  document.getElementById('bBloom').addEventListener('click', e => {
    S.bloom = !S.bloom;
    e.currentTarget.classList.toggle('on', S.bloom);
  });
  document.getElementById('bOrbit').addEventListener('click', e => {
    S.orbit = !S.orbit;
    e.currentTarget.classList.toggle('on', S.orbit);
  });

  const rSpeed = document.getElementById('rSpeed'), vSpeed = document.getElementById('vSpeed');
  rSpeed.addEventListener('input', () => {
    S.speed = rSpeed.value / 100;
    vSpeed.textContent = S.speed.toFixed(1) + '×';
  });

  /* The extension owns the save dialog, so the webview only builds the payload. */
  function buildTracePayload() {
    const outIds = net.layerNodes[net.L - 1];
    return {
      graph: net.spec.meta || {},
      input: Array.from(pass.input).map(v => +v.toFixed(4)),
      decision: {
        action: net.outNames[pass.winner],
        index: pass.winner,
        probabilities: outIds.map((id, i) => ({ action: net.outNames[i], p: +pass.probs[i].toFixed(5) }))
      },
      path: S.lastTrace ? {
        from: net.nodes[S.lastTrace.node].label,
        units: Array.from(S.lastTrace.t.nodeSet).map(i => net.nodes[i].label),
        edges: Array.from(S.lastTrace.t.edgeSet).map(ei => ({
          from: net.nodes[net.edges[ei].s].label,
          to: net.nodes[net.edges[ei].t].label,
          w: +net.edges[ei].w.toFixed(4)
        }))
      } : null,
      exportedAt: new Date().toISOString()
    };
  }

  /* Activations for the sidebar, keyed layer:unit — sent once per pass. */
  function activationMap() {
    const out = {};
    for (let li = 0; li < net.L; li++) {
      const ids = net.layerNodes[li];
      for (let i = 0; i < ids.length && i < 48; i++) out[li + ':' + i] = +pass.act[ids[i]].toFixed(3);
    }
    return out;
  }

  window.addEventListener('keydown', e => {
    if (e.target && /input|textarea/i.test(e.target.tagName)) return;
    if (e.code === 'Space') { e.preventDefault(); document.getElementById('bRun').click(); }
    else if (e.key === 'n' || e.key === 'N') newInput();
    else if (e.key === 'r' || e.key === 'R') rig.home();
    else if (e.key === 'l' || e.key === 'L') document.getElementById('bLabels').click();
    else if (e.key === 't' || e.key === 'T') document.getElementById('bTrace').click();
    else if (e.key === 'Escape') { inspect.classList.remove('on'); S.selected = -1; clearTrace(); }
  });

  /* ══════════════════════════════════════════════════════════
     13 · RESIZE
     ══════════════════════════════════════════════════════════ */
  function resize() {
    const w = window.innerWidth, h = window.innerHeight;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h);
    sizeTargets(w, h);
    uniforms.uScale.value = Math.min(1, w / 1400) * 0.75 + 0.35;
  }
  window.addEventListener('resize', resize);

  /* ══════════════════════════════════════════════════════════
     14 · MAIN LOOP
     ══════════════════════════════════════════════════════════ */
  const sFps = document.getElementById('sFps'), sMs = document.getElementById('sMs'),
        sCalls = document.getElementById('sCalls'), sPass = document.getElementById('sPass');
  let fpsAcc = 0, fpsN = 0, msAcc = 0, statT = 0;
  const projV = new THREE.Vector3();

  function updateActivations(dt) {
    if (!pass) return;
    const N = net.nodes.length;
    for (let i = 0; i < N; i++) {
      const n = net.nodes[i];
      const p = clamp((S.wave - n.li) / 0.55, 0, 1);
      const v = easeOut(p) * pass.act[i];
      aAct[i] = v; glowAct[i] = v;
    }
    nodeMesh.geometry.attributes.aAct.needsUpdate = true;
    glowPts.geometry.attributes.aAct.needsUpdate = true;
  }

  function updateRail() {
    if (!pass) return;
    const reached = clamp((S.wave - (net.L - 1)) / 0.5, 0, 1);
    for (let i = 0; i < actEls.length; i++) {
      const p = pass.probs[i] * reached;
      actEls[i].bg.style.height = (p * 100).toFixed(1) + '%';
      actEls[i].p.textContent = (p * 100).toFixed(1) + '%';
    }
    if (reached >= 1 && !S.locked) {
      S.locked = true;
      const name = net.outNames[pass.winner];
      decisionEl.textContent = name;
      decisionSubEl.textContent = 'confidence ' + (pass.probs[pass.winner] * 100).toFixed(1) + '%';
      railHead.classList.add('locked');
      actEls[pass.winner].el.classList.add('win', 'locked');
      if (S.selected < 0) traceFrom(pass.winnerNode);
      send({ type: 'decision', action: name, confidence: pass.probs[pass.winner] });
      send({ type: 'activations', values: activationMap() });
    }
  }

  function updateLabels() {
    if (!S.labels || !labelEls.length) return;
    const w = window.innerWidth, h = window.innerHeight;
    for (let li = 0; li < net.L; li++) {
      projV.set(net.layerX[li], net.layerRadius[li] + 1.5, 0).project(camera);
      const el = labelEls[li];
      if (projV.z > 1) { el.style.opacity = '0'; continue; }
      const x = (projV.x * 0.5 + 0.5) * w, y = (-projV.y * 0.5 + 0.5) * h;
      el.style.transform = 'translate(-50%,-100%) translate(' + x.toFixed(1) + 'px,' + y.toFixed(1) + 'px)';
      el.style.left = '0'; el.style.top = '0';
      const near = Math.abs(S.wave - li) < 0.6;
      el.classList.toggle('hot', near);
      el.style.opacity = String(clamp(1 - (rig.dist - 70) / 60, 0.25, 1));
    }
  }

  function loop() {
    requestAnimationFrame(loop);
    /* Asleep while the data-structure renderer owns the screen: keep the
       clock ticking so nothing jumps on return, but skip the GPU work. */
    if (!awake()) { clock.getDelta(); return; }
    const dt = Math.min(clock.getDelta(), 0.05);
    const t = clock.elapsedTime;
    uniforms.uTime.value = t;
    compMat.uniforms.uTime.value = t % 100.0;

    if (uniforms.uBoot.value < 1) uniforms.uBoot.value = Math.min(1, uniforms.uBoot.value + dt * 0.55);

    /* inference clock */
    if (S.running && pass) {
      if (S.holding > 0) {
        S.holding -= dt;
        if (S.holding <= 0) newInput();
      } else {
        S.wave += dt * 3.4 * S.speed;
        if (S.wave > net.L - 1 + 0.55) { S.wave = net.L - 1 + 0.55; S.holding = 2.0 / S.speed; }
      }
    }
    uniforms.uWave.value = S.wave;

    updateActivations(dt);
    updateRail();

    if (S.orbit && !REDUCED) rig.tTheta += dt * 0.055;
    rig.apply(dt);
    updateHover();
    updateLabels();

    sPass.textContent = !S.running ? 'paused'
      : S.holding > 0 ? 'locked'
      : 'layer ' + clamp(Math.floor(S.wave) + 1, 1, net.L) + '/' + net.L;

    /* render */
    if (S.bloom && rtScene) {
      renderer.setRenderTarget(rtScene);
      renderer.clear();
      renderer.render(scene, camera);
      renderer.setRenderTarget(null);

      brightMat.uniforms.tDiffuse.value = rtScene.texture;
      blit(brightMat, rtA);

      const px = 1 / rtA.width, py = 1 / rtA.height;
      blurMat.uniforms.tDiffuse.value = rtA.texture;
      blurMat.uniforms.uDir.value.set(px, 0); blit(blurMat, rtB);
      blurMat.uniforms.tDiffuse.value = rtB.texture;
      blurMat.uniforms.uDir.value.set(0, py); blit(blurMat, rtA);
      blurMat.uniforms.tDiffuse.value = rtA.texture;
      blurMat.uniforms.uDir.value.set(px * 2.4, 0); blit(blurMat, rtB);
      blurMat.uniforms.tDiffuse.value = rtB.texture;
      blurMat.uniforms.uDir.value.set(0, py * 2.4); blit(blurMat, rtA);

      compMat.uniforms.tBase.value = rtScene.texture;
      compMat.uniforms.tBloom.value = rtA.texture;
      compMat.uniforms.uStrength.value = 1.0;
      blit(compMat, null);
    } else if (rtScene) {
      renderer.setRenderTarget(rtScene);
      renderer.clear();
      renderer.render(scene, camera);
      renderer.setRenderTarget(null);
      compMat.uniforms.tBase.value = rtScene.texture;
      compMat.uniforms.tBloom.value = blackPixel;
      compMat.uniforms.uStrength.value = 0;
      blit(compMat, null);
    } else {
      renderer.render(scene, camera);
    }

    /* stats */
    fpsAcc += 1 / Math.max(dt, 1e-4); fpsN++; msAcc += dt * 1000; statT += dt;
    if (statT > 0.5) {
      sFps.textContent = Math.round(fpsAcc / fpsN);
      sMs.textContent = (msAcc / fpsN).toFixed(1) + ' ms';
      sCalls.textContent = renderer.info.render.calls;
      fpsAcc = 0; fpsN = 0; msAcc = 0; statT = 0;
    }
  }

  /* ══════════════════════════════════════════════════════════
     15 · EXTENSION BRIDGE
     ══════════════════════════════════════════════════════════ */
  const invalidEl = document.getElementById('invalid');
  const invalidMsg = document.getElementById('invalidMsg');

  function applyConfig(cfg) {
    if (!cfg) return;
    if (typeof cfg.speed === 'number') {
      S.speed = clamp(cfg.speed, 0.25, 3);
      rSpeed.value = String(Math.round(S.speed * 100));
      vSpeed.textContent = S.speed.toFixed(1) + '\u00d7';
    }
    if (typeof cfg.glow === 'boolean') { S.bloom = cfg.glow; setToggle('bBloom', S.bloom); }
    if (typeof cfg.autoOrbit === 'boolean') { S.orbit = cfg.autoOrbit; setToggle('bOrbit', S.orbit); }
    if (typeof cfg.labels === 'boolean') {
      S.labels = cfg.labels;
      setToggle('bLabels', S.labels);
      labelHost.style.display = S.labels ? '' : 'none';
    }
  }

  function load(spec) {
    invalidEl.classList.remove('on');
    buildGraph(spec);
    resize();
    newInput();
    rig.home();
    document.querySelectorAll('.enter').forEach((el, i) => {
      setTimeout(() => el.classList.add('in'), i * 80);
    });
  }

  /**
   * An external trace either supplies an input vector for the local forward
   * pass, or a full activation array computed elsewhere.
   */
  function applyTrace(trace) {
    if (!trace || !pass) return;
    if (Array.isArray(trace.input) && trace.input.length === net.layerNodes[0].length) {
      const inp = trace.input.map(Number);
      pass = forward(net, inp);
      pass.input = inp;
      S.wave = -0.6; S.holding = 0; S.locked = false;
      railHead.classList.remove('locked');
      actEls.forEach(a => a.el.classList.remove('win', 'locked'));
      clearTrace();
      return;
    }
    if (Array.isArray(trace.act) && trace.act.length === net.nodes.length) {
      for (let i = 0; i < trace.act.length; i++) pass.act[i] = clamp(Number(trace.act[i]) || 0, 0, 1);
      if (Array.isArray(trace.probs) && trace.probs.length === actEls.length) {
        let w = 0;
        for (let i = 0; i < trace.probs.length; i++) {
          pass.probs[i] = Number(trace.probs[i]) || 0;
          if (pass.probs[i] > pass.probs[w]) w = i;
        }
        pass.winner = w;
        pass.winnerNode = net.layerNodes[net.L - 1][w];
      }
      S.wave = net.L - 1 + 0.55; S.locked = false; S.holding = 3;
      return;
    }
    decisionSubEl.textContent = "that trace didn't match this graph";
  }

  window.addEventListener('message', ev => {
    const m = ev.data || {};
    switch (m.type) {
      case 'spec':
        if (bridge) bridge.setMode('net');
        applyConfig(m.config);
        try { load(m.spec); }
        catch (err) {
          invalidMsg.textContent = 'The renderer could not build this graph. ' + (err && err.message);
          invalidEl.classList.add('on');
        }
        break;
      case 'config':
        applyConfig(m.config);
        break;
      case 'invalid':
        invalidMsg.textContent = m.message || '';
        invalidEl.classList.add('on');
        break;
      case 'focus':
        if (net) {
          if (m.unit >= 0) {
            const id = net.layerNodes[m.layer] && net.layerNodes[m.layer][m.unit];
            if (id !== undefined) { selectNode(id, true); traceFrom(id); }
          } else {
            rig.focusLayer(m.layer);
          }
          S.orbit = false; setToggle('bOrbit', false);
        }
        break;
      case 'trace':
        applyTrace(m.trace);
        break;
      case 'cmd':
        if (m.name === 'run') document.getElementById('bRun').click();
        else if (m.name === 'newInput') newInput();
        else if (m.name === 'trace') document.getElementById('bTrace').click();
        else if (m.name === 'export') send({ type: 'export', payload: buildTracePayload() });
        break;
      default:
        break;
    }
  });

  /* Draw something at once; the real spec replaces it on the first message. */
  load(FALLBACK.spec());
  loop();
  send({ type: 'ready' });

})();
