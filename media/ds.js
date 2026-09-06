/**
 * VYUHA — data structure renderer.
 *
 * Draws whatever the running program printed: linked lists, stacks, queues,
 * arrays, matrices, trees and graphs. Every frame the program emitted becomes
 * one moment on a timeline, so an algorithm can be watched rather than traced
 * by hand.
 *
 * It shares the document with media/main.js (the network renderer). Only one
 * of the two is awake at a time; the bridge decides which.
 */
(function () {
  'use strict';

  var bridge = window.__vyuha;
  var send = function (m) { if (bridge) bridge.postMessage(m); };
  var MODE = 'ds';
  var awake = function () { return bridge && bridge.isActive(MODE); };

  if (typeof THREE === 'undefined') { return; }

  /* ── constants ────────────────────────────────────────────── */

  var STATE_COL = {
    normal: 0x6aa8ff,
    active: 0xffc46b,
    visited: 0xa382ff,
    done: 0x35f0a8,
    error: 0xff5470
  };
  var EDGE_COL = {
    normal: 0x2f4a6d,
    active: 0xffc46b,
    visited: 0x7a5fd0,
    done: 0x2aa87a,
    error: 0xff5470
  };
  var KIND_TITLE = {
    list: 'linked list', tree: 'tree', graph: 'graph', array: 'array',
    stack: 'stack', queue: 'queue', matrix: 'matrix'
  };

  var GAP = 2.35;
  var REDUCED = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ── tiny DOM helper that tolerates a missing element ─────── */

  var DUMMY = { textContent: '', value: 0, style: {}, classList: { add: noop, remove: noop, toggle: noop, contains: function () { return false; } }, addEventListener: noop, appendChild: noop, setAttribute: noop, getBoundingClientRect: function () { return { left: 0, top: 0, width: 1, height: 1 }; } };
  function noop() {}
  function $(id) { return document.getElementById(id) || DUMMY; }

  /* ── state ────────────────────────────────────────────────── */

  var S = {
    frames: [],
    index: -1,
    playing: false,
    hold: 420,
    since: 0,
    labels: true,
    glow: true,
    running: false,
    selected: null,
    file: ''
  };

  /* ── scene ────────────────────────────────────────────────── */

  var scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(0x05070d, 0.018);

  var camera = new THREE.PerspectiveCamera(50, aspect(), 0.1, 600);
  var renderer;
  try {
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance', preserveDrawingBuffer: true });
  } catch (err) {
    $('fail').style.display = 'grid';
    return;
  }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setClearColor(0x05070d, 1);
  renderer.domElement.id = 'cvDs';
  document.body.appendChild(renderer.domElement);

  scene.add(new THREE.AmbientLight(0x2a3550, 1.0));
  var key = new THREE.DirectionalLight(0xbcd8ff, 1.15);
  key.position.set(6, 12, 9);
  scene.add(key);
  var rim = new THREE.DirectionalLight(0xff8fd0, 0.5);
  rim.position.set(-8, -4, -7);
  scene.add(rim);

  var floor = new THREE.GridHelper(120, 60, 0x16233a, 0x0e1626);
  floor.position.y = -6;
  floor.material.transparent = true;
  floor.material.opacity = 0.35;
  scene.add(floor);

  var root = new THREE.Group();
  scene.add(root);

  function aspect() {
    return Math.max(0.2, (window.innerWidth || 1) / (window.innerHeight || 1));
  }

  /* ── camera rig: drag to orbit, right-drag to pan, wheel to zoom ── */

  var rig = {
    target: new THREE.Vector3(0, 0, 0),
    goal: new THREE.Vector3(0, 0, 0),
    yaw: 0.62, pitch: 0.42, dist: 34,
    goalYaw: 0.62, goalPitch: 0.42, goalDist: 34
  };

  function applyCamera(dt) {
    var k = REDUCED ? 1 : Math.min(1, dt * 7);
    rig.yaw += (rig.goalYaw - rig.yaw) * k;
    rig.pitch += (rig.goalPitch - rig.pitch) * k;
    rig.dist += (rig.goalDist - rig.dist) * k;
    rig.target.lerp(rig.goal, k);
    var cp = Math.cos(rig.pitch), sp = Math.sin(rig.pitch);
    camera.position.set(
      rig.target.x + rig.dist * cp * Math.sin(rig.yaw),
      rig.target.y + rig.dist * sp,
      rig.target.z + rig.dist * cp * Math.cos(rig.yaw)
    );
    camera.lookAt(rig.target);
  }

  var drag = null;
  renderer.domElement.addEventListener('pointerdown', function (e) {
    if (!awake()) return;
    drag = { x: e.clientX, y: e.clientY, pan: e.button === 2 || e.shiftKey, moved: false };
    renderer.domElement.setPointerCapture(e.pointerId);
  });
  renderer.domElement.addEventListener('pointermove', function (e) {
    if (!awake()) return;
    if (!drag) { hover(e); return; }
    var dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    if (Math.abs(dx) + Math.abs(dy) > 3) drag.moved = true;
    drag.x = e.clientX; drag.y = e.clientY;
    if (drag.pan) {
      var right = new THREE.Vector3().setFromMatrixColumn(camera.matrix, 0);
      var up = new THREE.Vector3().setFromMatrixColumn(camera.matrix, 1);
      var s = rig.dist * 0.0016;
      rig.goal.addScaledVector(right, -dx * s).addScaledVector(up, dy * s);
    } else {
      rig.goalYaw -= dx * 0.006;
      rig.goalPitch = clamp(rig.goalPitch + dy * 0.005, -1.35, 1.35);
    }
  });
  renderer.domElement.addEventListener('pointerup', function (e) {
    if (drag && !drag.moved) pick(e);
    drag = null;
  });
  renderer.domElement.addEventListener('pointerleave', function () { drag = null; $('tip').classList.remove('on'); });
  renderer.domElement.addEventListener('contextmenu', function (e) { e.preventDefault(); });
  renderer.domElement.addEventListener('wheel', function (e) {
    if (!awake()) return;
    e.preventDefault();
    rig.goalDist = clamp(rig.goalDist * (1 + Math.sign(e.deltaY) * 0.12), 6, 220);
  }, { passive: false });

  /* ── label sprites ────────────────────────────────────────── */

  var labelCache = {};
  function labelTexture(text) {
    if (labelCache[text]) return labelCache[text];
    var pad = 16, fs = 44;
    var c = document.createElement('canvas');
    var ctx = c.getContext('2d');
    if (!ctx) return null;
    ctx.font = '700 ' + fs + 'px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';
    var w = Math.ceil(ctx.measureText(text).width) + pad * 2;
    c.width = Math.max(64, w);
    c.height = fs + pad * 2;
    ctx = c.getContext('2d');
    ctx.font = '700 ' + fs + 'px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = 'rgba(4,7,13,0.0)';
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.shadowColor = 'rgba(0,0,0,0.9)';
    ctx.shadowBlur = 10;
    ctx.fillStyle = '#eaf3ff';
    ctx.fillText(text, c.width / 2, c.height / 2);
    var tex = new THREE.CanvasTexture(c);
    tex.minFilter = THREE.LinearFilter;
    tex.needsUpdate = true;
    labelCache[text] = { tex: tex, w: c.width, h: c.height };
    return labelCache[text];
  }

  function makeLabel(text) {
    var t = labelTexture(text);
    if (!t) return null;
    var mat = new THREE.SpriteMaterial({ map: t.tex, transparent: true, depthTest: false, depthWrite: false });
    var sp = new THREE.Sprite(mat);
    var scale = 1.15;
    sp.scale.set((t.w / t.h) * scale, scale, 1);
    sp.renderOrder = 5;
    return sp;
  }

  /* ── halo texture for the glow pass ───────────────────────── */

  var haloTex = (function () {
    var s = 128, c = document.createElement('canvas');
    c.width = c.height = s;
    var ctx = c.getContext('2d');
    if (!ctx) return null;
    var g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
    g.addColorStop(0, 'rgba(255,255,255,0.95)');
    g.addColorStop(0.35, 'rgba(255,255,255,0.28)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, s, s);
    return new THREE.CanvasTexture(c);
  })();

  /* ── node objects ─────────────────────────────────────────── */

  var boxGeo = new THREE.BoxGeometry(1, 1, 1);
  var sphereGeo = new THREE.SphereGeometry(0.62, 22, 16);
  var nodes = {};     // id -> { mesh, halo, label, target, data }
  var edgeLines = null;
  var edgeLabels = [];
  var arrowHeads = null;
  var arrowGeo = new THREE.ConeGeometry(0.17, 0.46, 10);

  function makeNode(d, shape) {
    var mat = new THREE.MeshStandardMaterial({
      color: STATE_COL[d.state] || STATE_COL.normal,
      emissive: STATE_COL[d.state] || STATE_COL.normal,
      emissiveIntensity: 0.35,
      roughness: 0.42,
      metalness: 0.18
    });
    var mesh = new THREE.Mesh(shape === 'box' ? boxGeo : sphereGeo, mat);
    mesh.userData.id = d.id;
    root.add(mesh);

    var halo = null;
    if (haloTex) {
      halo = new THREE.Sprite(new THREE.SpriteMaterial({
        map: haloTex, color: STATE_COL[d.state] || STATE_COL.normal,
        transparent: true, blending: THREE.AdditiveBlending,
        depthTest: false, depthWrite: false, opacity: 0.5
      }));
      halo.scale.set(3.6, 3.6, 1);
      halo.renderOrder = 1;
      root.add(halo);
    }

    var label = makeLabel(d.label || d.id);
    if (label) root.add(label);

    return {
      mesh: mesh, halo: halo, label: label, labelText: d.label || d.id,
      pos: new THREE.Vector3(), target: new THREE.Vector3(), data: d, born: 0
    };
  }

  function disposeNode(n) {
    root.remove(n.mesh);
    n.mesh.material.dispose();
    if (n.halo) { root.remove(n.halo); n.halo.material.dispose(); }
    if (n.label) { root.remove(n.label); n.label.material.dispose(); }
  }

  function clearAll() {
    Object.keys(nodes).forEach(function (id) { disposeNode(nodes[id]); });
    nodes = {};
    clearEdges();
  }

  function clearEdges() {
    if (edgeLines) { root.remove(edgeLines); edgeLines.geometry.dispose(); edgeLines.material.dispose(); edgeLines = null; }
    if (arrowHeads) { root.remove(arrowHeads); arrowHeads.material.dispose(); arrowHeads = null; }
    edgeLabels.forEach(function (l) { root.remove(l); l.material.dispose(); });
    edgeLabels = [];
  }

  /* ── layouts ──────────────────────────────────────────────── */

  var graphPosCache = { key: '', pos: {} };

  function layout(frame) {
    var kind = frame.kind;
    var pos = {};
    var ns = frame.nodes;

    if (kind === 'array' || kind === 'list' || kind === 'queue') {
      var n = ns.length;
      ns.forEach(function (d, i) {
        var col = (d.col !== undefined ? d.col : i);
        pos[d.id] = new THREE.Vector3((col - (n - 1) / 2) * GAP, 0, 0);
      });
    } else if (kind === 'stack') {
      ns.forEach(function (d, i) {
        pos[d.id] = new THREE.Vector3(0, (i - (ns.length - 1) / 2) * (GAP * 0.75), 0);
      });
    } else if (kind === 'matrix') {
      var rows = 0, cols = 0;
      ns.forEach(function (d) {
        rows = Math.max(rows, (d.row || 0) + 1);
        cols = Math.max(cols, (d.col || 0) + 1);
      });
      ns.forEach(function (d) {
        pos[d.id] = new THREE.Vector3(
          ((d.col || 0) - (cols - 1) / 2) * GAP,
          0,
          ((d.row || 0) - (rows - 1) / 2) * GAP
        );
      });
    } else if (kind === 'tree') {
      treeLayout(frame, pos);
    } else {
      graphLayout(frame, pos);
    }

    // Explicit coordinates always win.
    ns.forEach(function (d) {
      if (d.x !== undefined || d.y !== undefined || d.z !== undefined) {
        pos[d.id] = new THREE.Vector3(d.x || 0, d.y || 0, d.z || 0);
      }
      if (!pos[d.id]) pos[d.id] = new THREE.Vector3(0, 0, 0);
    });
    return pos;
  }

  function treeLayout(frame, pos) {
    var children = {}, indeg = {};
    frame.nodes.forEach(function (d) { children[d.id] = []; indeg[d.id] = 0; });
    frame.edges.forEach(function (e) {
      if (children[e.from] && indeg[e.to] !== undefined) {
        children[e.from].push(e.to);
        indeg[e.to]++;
      }
    });
    var roots = frame.nodes.filter(function (d) { return indeg[d.id] === 0; }).map(function (d) { return d.id; });
    if (!roots.length && frame.nodes.length) roots = [frame.nodes[0].id];

    var depth = {}, cursor = 0, xs = {};
    var seen = {};
    function walk(id, d) {
      if (seen[id]) return;
      seen[id] = true;
      depth[id] = d;
      var kids = children[id] || [];
      if (!kids.length) {
        xs[id] = cursor++;
        return;
      }
      var first = null, last = null;
      kids.forEach(function (k) {
        if (seen[k]) return;
        walk(k, d + 1);
        if (first === null) first = xs[k];
        last = xs[k];
      });
      xs[id] = (first === null) ? cursor++ : (first + last) / 2;
    }
    roots.forEach(function (r) { walk(r, 0); });
    frame.nodes.forEach(function (d) { if (!seen[d.id]) walk(d.id, 0); });

    var maxX = 0, maxD = 0;
    Object.keys(xs).forEach(function (k) { maxX = Math.max(maxX, xs[k]); });
    Object.keys(depth).forEach(function (k) { maxD = Math.max(maxD, depth[k]); });

    frame.nodes.forEach(function (d) {
      pos[d.id] = new THREE.Vector3(
        (xs[d.id] - maxX / 2) * GAP,
        (maxD / 2 - depth[d.id]) * (GAP * 1.25),
        0
      );
    });
  }

  /**
   * A small deterministic force layout. Positions are cached against the node
   * and edge set, so consecutive frames of the same graph do not jitter.
   */
  function graphLayout(frame, pos) {
    var key = frame.nodes.map(function (d) { return d.id; }).join(',') + '|' +
              frame.edges.map(function (e) { return e.from + '>' + e.to; }).join(',');
    if (graphPosCache.key === key) {
      frame.nodes.forEach(function (d) { pos[d.id] = graphPosCache.pos[d.id].clone(); });
      return;
    }
    var n = frame.nodes.length;
    var idx = {}, P = [];
    var seed = 1337;
    function rnd() { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; }
    frame.nodes.forEach(function (d, i) {
      idx[d.id] = i;
      var a = (i / Math.max(1, n)) * Math.PI * 2;
      var r = 3 + Math.sqrt(n) * 1.6;
      P.push(new THREE.Vector3(Math.cos(a) * r, (rnd() - 0.5) * 3, Math.sin(a) * r));
    });
    var links = frame.edges
      .filter(function (e) { return idx[e.from] !== undefined && idx[e.to] !== undefined; })
      .map(function (e) { return [idx[e.from], idx[e.to]]; });

    var ideal = GAP * 1.9;
    for (var it = 0; it < 220; it++) {
      var cool = 1 - it / 220;
      for (var i = 0; i < n; i++) {
        for (var j = i + 1; j < n; j++) {
          var d = P[i].distanceTo(P[j]) || 0.01;
          var f = (ideal * ideal * 1.1) / (d * d);
          var dir = P[i].clone().sub(P[j]).multiplyScalar(f * 0.02 * cool / d);
          P[i].add(dir); P[j].sub(dir);
        }
      }
      links.forEach(function (l) {
        var a = P[l[0]], b = P[l[1]];
        var d = a.distanceTo(b) || 0.01;
        var f = (d - ideal) * 0.10 * cool;
        var dir = b.clone().sub(a).multiplyScalar(f / d);
        a.add(dir); b.sub(dir);
      });
    }
    var mid = new THREE.Vector3();
    P.forEach(function (p) { mid.add(p); });
    mid.multiplyScalar(1 / Math.max(1, n));
    P.forEach(function (p) { p.sub(mid); });

    graphPosCache = { key: key, pos: {} };
    frame.nodes.forEach(function (d, i) {
      graphPosCache.pos[d.id] = P[i].clone();
      pos[d.id] = P[i].clone();
    });
  }

  /* ── applying a frame ─────────────────────────────────────── */

  function valueScale(frame) {
    var vals = frame.nodes.map(function (d) { return typeof d.value === 'number' ? d.value : null; })
                          .filter(function (v) { return v !== null; });
    if (!vals.length) return null;
    var lo = Math.min.apply(null, vals), hi = Math.max.apply(null, vals);
    if (hi === lo) return null;
    return { lo: lo, hi: hi };
  }

  function applyFrame(frame, immediate) {
    var shape = (frame.kind === 'tree' || frame.kind === 'graph') ? 'sphere' : 'box';
    var pos = layout(frame);
    var vs = (frame.kind === 'array' || frame.kind === 'matrix') ? valueScale(frame) : null;

    var present = {};
    frame.nodes.forEach(function (d) {
      present[d.id] = true;
      var n = nodes[d.id];
      var wantBox = shape === 'box';
      if (n && (n.mesh.geometry === boxGeo) !== wantBox) { disposeNode(n); delete nodes[d.id]; n = null; }
      if (!n) {
        n = makeNode(d, shape);
        n.pos.copy(pos[d.id]);
        n.pos.y += 8;             // drop into place
        nodes[d.id] = n;
      }
      n.data = d;
      n.target.copy(pos[d.id]);

      var col = STATE_COL[d.state] || STATE_COL.normal;
      n.mesh.material.color.setHex(col);
      n.mesh.material.emissive.setHex(col);
      n.mesh.material.emissiveIntensity = d.state === 'active' ? 0.95 : d.state === 'normal' ? 0.3 : 0.6;
      if (n.halo) {
        n.halo.material.color.setHex(col);
        n.halo.material.opacity = S.glow ? (d.state === 'active' ? 0.85 : 0.42) : 0;
      }

      // Bars carry magnitude in array and matrix views.
      var h = 1;
      if (vs && typeof d.value === 'number') h = 0.6 + 3.4 * ((d.value - vs.lo) / (vs.hi - vs.lo));
      if (wantBox) {
        n.mesh.scale.set(1.5, h, 1.5);
        n.target.y += (h - 1) / 2;
      } else {
        n.mesh.scale.setScalar(d.state === 'active' ? 1.22 : 1);
      }

      if (n.labelText !== (d.label || d.id)) {
        if (n.label) { root.remove(n.label); n.label.material.dispose(); }
        n.label = makeLabel(d.label || d.id);
        if (n.label) root.add(n.label);
        n.labelText = d.label || d.id;
      }
      if (n.label) n.label.visible = S.labels;

      if (immediate) n.pos.copy(n.target);
    });

    Object.keys(nodes).forEach(function (id) {
      if (!present[id]) { disposeNode(nodes[id]); delete nodes[id]; }
    });

    buildEdges(frame);
    frameStats(frame);
    frameCaption(frame);
    fitCamera(immediate);
  }

  function buildEdges(frame) {
    clearEdges();
    var live = frame.edges.filter(function (e) { return nodes[e.from] && nodes[e.to]; });
    if (!live.length) { root.userData.edges = []; return; }

    var positions = new Float32Array(live.length * 6);
    var colors = new Float32Array(live.length * 6);
    var c = new THREE.Color();
    live.forEach(function (e, i) {
      c.setHex(EDGE_COL[e.state] || EDGE_COL.normal);
      for (var k = 0; k < 2; k++) {
        colors[i * 6 + k * 3] = c.r;
        colors[i * 6 + k * 3 + 1] = c.g;
        colors[i * 6 + k * 3 + 2] = c.b;
      }
    });
    var geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    edgeLines = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({
      vertexColors: true, transparent: true, opacity: 0.85
    }));
    edgeLines.frustumCulled = false;
    root.add(edgeLines);

    var directed = live.filter(function (e) { return e.directed; });
    if (directed.length) {
      arrowHeads = new THREE.InstancedMesh(
        arrowGeo,
        new THREE.MeshBasicMaterial({ color: 0x9fc0ea, transparent: true, opacity: 0.9 }),
        directed.length
      );
      arrowHeads.frustumCulled = false;
      root.add(arrowHeads);
    }
    root.userData.edges = live;
    root.userData.directed = directed;
  }

  var _a = new THREE.Vector3(), _b = new THREE.Vector3(), _m = new THREE.Vector3();
  var _q = new THREE.Quaternion(), _up = new THREE.Vector3(0, 1, 0), _dir = new THREE.Vector3();
  var _mat = new THREE.Matrix4();

  function updateEdgeGeometry() {
    var live = root.userData.edges || [];
    if (!edgeLines || !live.length) return;
    var attr = edgeLines.geometry.getAttribute('position');
    live.forEach(function (e, i) {
      var A = nodes[e.from], B = nodes[e.to];
      if (!A || !B) return;
      attr.setXYZ(i * 2, A.pos.x, A.pos.y, A.pos.z);
      attr.setXYZ(i * 2 + 1, B.pos.x, B.pos.y, B.pos.z);
    });
    attr.needsUpdate = true;
    edgeLines.geometry.computeBoundingSphere();

    var dirs = root.userData.directed || [];
    if (arrowHeads && dirs.length) {
      dirs.forEach(function (e, i) {
        var A = nodes[e.from], B = nodes[e.to];
        if (!A || !B) return;
        _a.copy(A.pos); _b.copy(B.pos);
        _dir.copy(_b).sub(_a);
        var len = _dir.length() || 1;
        _dir.multiplyScalar(1 / len);
        _m.copy(_b).addScaledVector(_dir, -0.95);
        _q.setFromUnitVectors(_up, _dir);
        _mat.compose(_m, _q, new THREE.Vector3(1, 1, 1));
        arrowHeads.setMatrixAt(i, _mat);
      });
      arrowHeads.instanceMatrix.needsUpdate = true;
    }
  }

  function frameStats(frame) {
    $('metaNote').textContent = KIND_TITLE[frame.kind] || frame.kind;
    $('metaName').textContent = frame.title || (S.file ? S.file.split(/[\\/]/).pop() : 'VYUHA');
    $('mLayers').textContent = String(S.index + 1);
    $('mNodes').textContent = String(frame.nodes.length);
    $('mEdges').textContent = String(frame.edges.length);
  }

  function frameCaption(frame) {
    $('capTitle').textContent = frame.title || (KIND_TITLE[frame.kind] || frame.kind);
    $('capNote').textContent = frame.note || '';
    $('tCount').textContent = (S.index + 1) + ' / ' + S.frames.length;
    var scrub = $('tScrub');
    scrub.max = String(Math.max(0, S.frames.length - 1));
    scrub.value = String(Math.max(0, S.index));
  }

  function fitCamera(immediate) {
    var ids = Object.keys(nodes);
    if (!ids.length) return;
    var box = new THREE.Box3();
    ids.forEach(function (id) { box.expandByPoint(nodes[id].target); });
    var size = box.getSize(new THREE.Vector3());
    var centre = box.getCenter(new THREE.Vector3());
    var span = Math.max(size.x, size.y, size.z, 4);
    var want = clamp(span * 1.5 + 8, 12, 200);
    rig.goal.copy(centre);
    // Only widen automatically; a user who zoomed in keeps their framing.
    if (immediate || want > rig.goalDist) rig.goalDist = want;
    if (immediate) { rig.target.copy(centre); rig.dist = want; }
  }

  /* ── picking and hover ────────────────────────────────────── */

  var ray = new THREE.Raycaster();
  var ndc = new THREE.Vector2();

  function meshes() {
    return Object.keys(nodes).map(function (id) { return nodes[id].mesh; });
  }

  function hit(e) {
    var r = renderer.domElement.getBoundingClientRect();
    ndc.x = ((e.clientX - r.left) / r.width) * 2 - 1;
    ndc.y = -((e.clientY - r.top) / r.height) * 2 + 1;
    ray.setFromCamera(ndc, camera);
    var res = ray.intersectObjects(meshes(), false);
    return res.length ? res[0].object.userData.id : null;
  }

  function hover(e) {
    var id = hit(e);
    var tip = $('tip');
    if (!id || !nodes[id]) { tip.classList.remove('on'); return; }
    var d = nodes[id].data;
    tip.textContent = d.label + (d.value !== undefined ? '  ·  ' + d.value : '') + '  ·  ' + d.state;
    tip.style.left = (e.clientX + 14) + 'px';
    tip.style.top = (e.clientY + 14) + 'px';
    tip.classList.add('on');
  }

  function pick(e) {
    var id = hit(e);
    if (!id || !nodes[id]) { closeInspect(); return; }
    S.selected = id;
    var d = nodes[id].data;
    var frame = S.frames[S.index];
    var incoming = [], outgoing = [];
    (frame ? frame.edges : []).forEach(function (ed) {
      if (ed.to === id) incoming.push(ed.from);
      if (ed.from === id) outgoing.push(ed.to);
    });
    $('inspectTitle').textContent = 'Node';
    $('inspectBody').innerHTML =
      row('label', d.label) +
      (d.value !== undefined ? row('value', String(d.value)) : '') +
      row('id', d.id) +
      row('state', d.state) +
      (d.note ? row('note', d.note) : '') +
      (incoming.length ? row('in', incoming.join(', ')) : '') +
      (outgoing.length ? row('out', outgoing.join(', ')) : '');
    $('inspect').classList.add('on');
    send({ type: 'selectNode', id: id, label: d.label, line: frame && frame.line });
  }

  function row(k, v) {
    return '<div class="r"><span>' + esc(k) + '</span><b>' + esc(v) + '</b></div>';
  }
  function esc(s) {
    return String(s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }
  function closeInspect() { $('inspect').classList.remove('on'); S.selected = null; }

  /* ── timeline ─────────────────────────────────────────────── */

  function show(i, immediate) {
    if (!S.frames.length) return;
    S.index = clamp(i, 0, S.frames.length - 1);
    applyFrame(S.frames[S.index], !!immediate);
    S.since = 0;
    send({ type: 'frameShown', index: S.index });
  }

  function setPlaying(on) {
    S.playing = on && S.frames.length > 1;
    var b = $('tPlay');
    b.textContent = S.playing ? 'Pause' : 'Play';
    b.classList.toggle('on', S.playing);
  }

  function step(delta) {
    setPlaying(false);
    show(S.index + delta);
  }

  /* ── controls ─────────────────────────────────────────────── */

  $('tPlay').addEventListener('click', function () {
    if (!S.playing && S.index >= S.frames.length - 1) show(0);
    setPlaying(!S.playing);
  });
  $('tNext').addEventListener('click', function () { step(1); });
  $('tPrev').addEventListener('click', function () { step(-1); });
  $('tScrub').addEventListener('input', function (e) {
    setPlaying(false);
    show(parseInt(e.target.value, 10) || 0);
  });
  $('tSpeed').addEventListener('input', function (e) {
    S.hold = parseInt(e.target.value, 10) || 420;
    $('tSpeedV').textContent = S.hold + 'ms';
  });
  $('tLabels').addEventListener('click', function () {
    S.labels = !S.labels;
    $('tLabels').classList.toggle('on', S.labels);
    Object.keys(nodes).forEach(function (id) { if (nodes[id].label) nodes[id].label.visible = S.labels; });
  });
  $('tGlow').addEventListener('click', function () {
    S.glow = !S.glow;
    $('tGlow').classList.toggle('on', S.glow);
    if (S.frames[S.index]) applyFrame(S.frames[S.index], false);
  });
  $('tReset').addEventListener('click', function () {
    rig.goalYaw = 0.62; rig.goalPitch = 0.42;
    fitCamera(true);
  });
  var gifBtn = $('tGif');
  if (gifBtn) gifBtn.addEventListener('click', function () { exportGif(); });
  $('closeInspect').addEventListener('click', closeInspect);

  window.addEventListener('keydown', function (e) {
    if (!awake()) return;
    if (e.key === ' ') { e.preventDefault(); $('tPlay').click(); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); step(1); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); step(-1); }
    else if (e.key === 'Escape') closeInspect();
    else if (e.key.toLowerCase() === 'l') $('tLabels').click();
    else if (e.key.toLowerCase() === 'r') $('tReset').click();
  });

  window.addEventListener('resize', function () {
    camera.aspect = aspect();
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });

  /* ── loop ─────────────────────────────────────────────────── */

  var clock = new THREE.Clock();
  var fpsAcc = 0, fpsN = 0, fpsAt = 0;

  function loop() {
    requestAnimationFrame(loop);
    var dt = Math.min(clock.getDelta(), 0.05);
    if (!awake()) return;

    var t0 = performance.now();

    var k = REDUCED ? 1 : Math.min(1, dt * 8);
    Object.keys(nodes).forEach(function (id) {
      var n = nodes[id];
      n.pos.lerp(n.target, k);
      n.mesh.position.copy(n.pos);
      if (n.halo) n.halo.position.copy(n.pos);
      if (n.label) {
        var lift = n.mesh.geometry === boxGeo ? (n.mesh.scale.y / 2 + 0.85) : 1.15;
        n.label.position.set(n.pos.x, n.pos.y + lift, n.pos.z);
      }
      if (n.data.state === 'active') {
        var p = 1 + Math.sin(clock.elapsedTime * 6) * 0.06;
        if (n.mesh.geometry !== boxGeo) n.mesh.scale.setScalar(1.22 * p);
      }
    });
    updateEdgeGeometry();

    if (S.playing && S.frames.length > 1) {
      S.since += dt * 1000;
      if (S.since >= S.hold) {
        if (S.index >= S.frames.length - 1) setPlaying(false);
        else show(S.index + 1);
      }
    }

    applyCamera(dt);
    renderer.render(scene, camera);

    var ms = performance.now() - t0;
    fpsAcc += dt; fpsN++;
    if (clock.elapsedTime - fpsAt > 0.5) {
      $('sFps').textContent = String(Math.round(fpsN / Math.max(0.0001, fpsAcc)));
      $('sMs').textContent = ms.toFixed(1) + 'ms';
      $('sCalls').textContent = String(renderer.info.render.calls);
      $('sPass').textContent = S.running ? 'running' : (S.playing ? 'playing' : 'idle');
      fpsAcc = 0; fpsN = 0; fpsAt = clock.elapsedTime;
    }
  }

  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }

  /* ── messages from the extension ──────────────────────────── */

  window.addEventListener('message', function (ev) {
    var m = ev.data || {};
    switch (m.type) {
      case 'runStart':
        if (bridge) bridge.setMode('ds');
        S.running = true;
        S.file = m.file || '';
        S.frames = [];
        S.index = -1;
        setPlaying(false);
        clearAll();
        graphPosCache = { key: '', pos: {} };
        applyRunConfig(m.config);
        $('waiting').classList.add('on');
        $('invalid').classList.remove('on');
        $('capTitle').textContent = 'Running ' + (S.file.split(/[\\/]/).pop() || '');
        $('capNote').textContent = m.command || '';
        $('tCount').textContent = '0 / 0';
        break;

      case 'frame':
        if (bridge) bridge.setMode('ds');
        $('waiting').classList.remove('on');
        S.frames.push(m.frame);
        // Follow along live while the program is still producing frames.
        if (S.running || S.index < 0) show(S.frames.length - 1, S.frames.length === 1);
        else frameCaption(S.frames[S.index]);
        break;

      case 'runEnd':
        S.running = false;
        if (!S.frames.length) {
          $('waiting').classList.add('on');
          $('capTitle').textContent = m.code === 0 ? 'Program finished' : 'Program exited with code ' + m.code;
          $('capNote').textContent = 'It did not print any @vyuha lines.';
        } else {
          $('capNote').textContent = S.frames.length + ' frames in ' + (m.elapsedMs / 1000).toFixed(2) + 's';
          if (m.autoPlay && S.frames.length > 1) { show(0, true); setPlaying(true); }
        }
        break;

      case 'goto':
        setPlaying(false);
        show(Number(m.index) || 0);
        break;

      case 'warn':
        $('invalidMsg').textContent = m.message || '';
        $('invalid').classList.add('on');
        setTimeout(function () { $('invalid').classList.remove('on'); }, 4200);
        break;

      case 'config':
        applyRunConfig(m.config);
        break;

      case 'cmd':
        if (m.name === 'playPause') $('tPlay').click();
        else if (m.name === 'next') step(1);
        else if (m.name === 'prev') step(-1);
        else if (m.name === 'export') {
          send({
            type: 'export',
            payload: { source: S.file, frames: S.frames, exportedAt: new Date().toISOString() }
          });
        }
        else if (m.name === 'exportGif') {
          exportGif();
        }
        break;

      default:
        break;
    }
  });

  /* ── GIF export ───────────────────────────────────────────────
   * Walk the timeline, render each frame to the canvas, downscale it to a
   * capped width, and hand the pixels to the offline GIF encoder. Everything
   * runs off the animation loop with explicit renders so what lands in the
   * file is exactly a frame the user could have paused on.
   */
  function exportGif() {
    if (!S.frames.length) { toast('Nothing to export yet — run a program first.'); return; }
    if (typeof GifEncoder === 'undefined') { toast('GIF encoder failed to load.'); return; }
    var wasPlaying = S.playing;
    setPlaying(false);

    // Cap the width so a long run does not produce a giant file.
    var maxW = 640;
    var srcW = renderer.domElement.width, srcH = renderer.domElement.height;
    var scale = Math.min(1, maxW / srcW);
    var gw = Math.max(2, Math.round(srcW * scale));
    var gh = Math.max(2, Math.round(srcH * scale));

    var tmp = document.createElement('canvas');
    tmp.width = gw; tmp.height = gh;
    var tctx = tmp.getContext('2d');

    var holdMs = Math.max(60, S.hold || 500);
    var enc = new GifEncoder(gw, gh, { delayMs: holdMs, loop: true });

    $('exportMsg').textContent = 'Rendering frames…';
    $('exportMsg').classList.add('on');

    var i = 0;
    var savedIndex = S.index;
    function grabNext() {
      if (i >= S.frames.length) { finishGif(enc, savedIndex, wasPlaying); return; }
      show(i, false);          // lay out and render frame i
      applyCamera(0);
      renderer.render(scene, camera);
      // Downscale the live GL canvas into the temp 2D canvas, then read it.
      tctx.drawImage(renderer.domElement, 0, 0, srcW, srcH, 0, 0, gw, gh);
      var data = tctx.getImageData(0, 0, gw, gh).data;
      enc.addFrame(data);
      i++;
      $('exportMsg').textContent = 'Rendering frames… ' + i + ' / ' + S.frames.length;
      // Yield so the UI can paint the progress line.
      setTimeout(grabNext, 0);
    }
    setTimeout(grabNext, 30);
  }

  function finishGif(enc, restoreIndex, wasPlaying) {
    $('exportMsg').textContent = 'Encoding GIF…';
    setTimeout(function () {
      var bytes = enc.finish();
      // base64 the bytes for the extension to write to disk.
      var CHUNK = 0x8000, str = '';
      for (var p = 0; p < bytes.length; p += CHUNK) {
        str += String.fromCharCode.apply(null, bytes.subarray(p, p + CHUNK));
      }
      send({ type: 'gif', b64: btoa(str), frames: enc.frames.length, source: S.file });
      $('exportMsg').textContent = 'Saved ' + enc.frames.length + '-frame GIF';
      setTimeout(function () { $('exportMsg').classList.remove('on'); }, 2600);
      if (restoreIndex >= 0) show(restoreIndex, false);
      if (wasPlaying) setPlaying(true);
    }, 20);
  }

  function toast(msg) {
    $('invalidMsg').textContent = msg;
    $('invalid').classList.add('on');
    setTimeout(function () { $('invalid').classList.remove('on'); }, 3200);
  }

  function applyRunConfig(c) {
    if (!c) return;
    if (typeof c.frameDelay === 'number') {
      S.hold = c.frameDelay;
      $('tSpeed').value = String(c.frameDelay);
      $('tSpeedV').textContent = c.frameDelay + 'ms';
    }
    if (typeof c.labels === 'boolean') {
      S.labels = c.labels;
      $('tLabels').classList.toggle('on', S.labels);
    }
    if (typeof c.glow === 'boolean') {
      S.glow = c.glow;
      $('tGlow').classList.toggle('on', S.glow);
    }
  }

  loop();
  window.__vyuhaDs = { state: S, nodes: function () { return nodes; }, show: show };
})();
