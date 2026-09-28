/**
 * VYUHA 4.0.0 — shared view controls.
 *
 * WHY THIS FILE EXISTS
 *   A tester asked for "a scrolling bar for increment and decrement in sizes".
 *   Before 4.0.0 zoom lived only on the mouse wheel (invisible to new users) and
 *   node size could not be changed at all. The only sliders were in the timeline
 *   bar, which the CSS hides below 820 px -- exactly the width of a panel opened
 *   beside the editor. So this file adds an always-visible dock with two sliders.
 *
 * WHAT IT DOES
 *   1. Builds the dock (Zoom + Size, each with + / - buttons and a readout).
 *   2. Routes dock input to whichever renderer is awake (net = main.js, ds = ds.js).
 *   3. Offers a double-tap detector both renderers use for "open this line".
 *   4. Offers a small hint chip for one-line feedback ("line 12 highlighted").
 *
 * HOW IT CONNECTS (flow)
 *   runview.ts loads it after bridge.js and before main.js / ds.js
 *     -> each renderer calls __vyuhaView.register(mode, api) once
 *     -> renderers call __vyuhaView.sync(mode, distance) from their render loop
 *     -> dock input calls api.setDist(...) / api.setSize(...) on the renderer.
 *   It deliberately has NO requestAnimationFrame of its own: the renderers already
 *   run one, and the jsdom tests keep only a single rAF callback.
 */
(function () {
  'use strict';

  var bridge = window.__vyuha;              // owns which renderer is awake (bridge.js)
  var renderers = {};                       // mode -> api registered by main.js / ds.js
  var size = 1;                             // one node-size value shared by both modes
  var SIZE_MIN = 0.4, SIZE_MAX = 2.5;       // limits: below 0.4 spheres vanish, above 2.5 they merge
  var ZOOM_STEPS = 1000;                    // slider resolution; log-mapped below
  var dragging = { zoom: false, size: false }; // while the user drags, sync() must not fight them
  var lastShown = { dist: -1, mode: '' };   // cache so sync() only touches the DOM on change

  /* ── helpers ──────────────────────────────────────────────── */

  // Current mode ('net' or 'ds'); falls back to 'ds' when there is no bridge (tests).
  function mode() { return bridge ? bridge.mode() : 'ds'; }

  // The renderer that owns the screen right now, or null before it registered.
  function active() { return renderers[mode()] || null; }

  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }

  // Why log mapping: camera distance runs 6..220. A linear slider would spend
  // most of its travel far away; log spacing makes each notch feel the same.
  // t = 0 -> farthest (slider bottom), t = 1 -> closest (slider top = "zoom in").
  function distToSlider(api, d) {
    var t = Math.log(api.max / clamp(d, api.min, api.max)) / Math.log(api.max / api.min);
    return Math.round(t * ZOOM_STEPS);
  }
  function sliderToDist(api, v) {
    var t = v / ZOOM_STEPS;
    return api.max * Math.pow(api.min / api.max, t);
  }

  /* ── build the dock DOM ───────────────────────────────────── */
  // Built from JS (not in runview.ts HTML) so the renderers and the dock ship
  // together and the jsdom tests get it without editing the HTML template.

  function el(tag, attrs, text) {
    var e = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) { e.setAttribute(k, attrs[k]); });
    if (text !== undefined) e.textContent = text;
    return e;
  }

  // One column = [+] button, vertical slider, [-] button, label, value readout.
  function column(id, label, min, max, value, title) {
    var col = el('div', { 'class': 'vd-col', id: 'vd-' + id });
    var plus = el('button', { 'class': 'btn vd-btn', id: 'vd-' + id + '-plus', title: title + ' up', 'aria-label': label + ' up' }, '+');
    // The range is rotated -90deg in CSS (see style.css) so it reads as a
    // vertical "scroll bar". Rotation, not writing-mode, because VS Code 1.84's
    // Chromium does not support vertical writing-mode on range inputs.
    var wrap = el('div', { 'class': 'vd-track' });
    var range = el('input', {
      type: 'range', id: 'vd-' + id + '-range', min: String(min), max: String(max),
      value: String(value), 'aria-label': label, title: title
    });
    wrap.appendChild(range);
    var minus = el('button', { 'class': 'btn vd-btn', id: 'vd-' + id + '-minus', title: title + ' down', 'aria-label': label + ' down' }, '\u2212');
    var name = el('span', { 'class': 'vd-name' }, label);
    var val = el('b', { 'class': 'vd-val', id: 'vd-' + id + '-val' }, '');
    col.appendChild(plus); col.appendChild(wrap); col.appendChild(minus);
    col.appendChild(name); col.appendChild(val);
    return { col: col, plus: plus, minus: minus, range: range, val: val };
  }

  var dock = el('div', { id: 'viewDock', 'class': 'panel', role: 'group', 'aria-label': 'Zoom and node size' });
  var zoom = column('zoom', 'Zoom', 0, ZOOM_STEPS, ZOOM_STEPS / 2, 'Zoom (mouse wheel, + / - keys)');
  var sz = column('size', 'Size', Math.round(SIZE_MIN * 100), Math.round(SIZE_MAX * 100), 100, 'Node size ([ / ] keys)');
  dock.appendChild(zoom.col);
  dock.appendChild(el('div', { 'class': 'vd-sep' }));
  dock.appendChild(sz.col);

  // Hint chip: short, self-dismissing feedback for double-click results.
  var hintEl = el('div', { id: 'viewHint', role: 'status', 'aria-live': 'polite' });
  var hintTimer = null;

  // #ui holds all chrome; attach there so pointer-events rules in style.css apply.
  var host = document.getElementById('ui') || document.body;
  host.appendChild(dock);
  host.appendChild(hintEl);

  /* ── zoom wiring ──────────────────────────────────────────── */

  // Show zoom as % of the renderer's default distance: 100% = how it opened.
  function showZoom(api, d) {
    zoom.val.textContent = Math.round((api.home / d) * 100) + '%';
  }

  // Apply a new distance to the awake renderer, then refresh slider + readout.
  function setZoom(d) {
    var api = active();
    if (!api) return;
    d = clamp(d, api.min, api.max);
    api.setDist(d);                         // renderer eases its camera to it
    zoom.range.value = String(distToSlider(api, d));
    showZoom(api, d);
    lastShown.dist = d; lastShown.mode = mode();
  }

  zoom.range.addEventListener('input', function () {
    var api = active();
    if (api) setZoom(sliderToDist(api, Number(zoom.range.value)));
  });
  // Track dragging so sync() (driven by the render loop) never yanks the thumb.
  zoom.range.addEventListener('pointerdown', function () { dragging.zoom = true; });
  window.addEventListener('pointerup', function () { dragging.zoom = false; dragging.size = false; });
  // Buttons step by 25% -- same feel as ~2 wheel notches.
  zoom.plus.addEventListener('click', function () { var a = active(); if (a) setZoom(a.getDist() / 1.25); });
  zoom.minus.addEventListener('click', function () { var a = active(); if (a) setZoom(a.getDist() * 1.25); });

  /* ── size wiring ──────────────────────────────────────────── */

  // Size is one value for both renderers, so switching mode keeps it.
  function setSize(s) {
    size = Math.round(clamp(s, SIZE_MIN, SIZE_MAX) * 100) / 100;
    sz.range.value = String(Math.round(size * 100));
    sz.val.textContent = size.toFixed(1) + '\u00d7';
    Object.keys(renderers).forEach(function (m) {
      try { renderers[m].setSize(size); } catch (e) { /* one renderer must not break the other */ }
    });
  }

  sz.range.addEventListener('input', function () { setSize(Number(sz.range.value) / 100); });
  sz.range.addEventListener('pointerdown', function () { dragging.size = true; });
  sz.plus.addEventListener('click', function () { setSize(size + 0.1); });
  sz.minus.addEventListener('click', function () { setSize(size - 0.1); });

  /* ── keyboard ─────────────────────────────────────────────── */
  // + / - zoom, ] / [ size. Skipped while typing so text fields still work.
  window.addEventListener('keydown', function (e) {
    if (e.target && /input|textarea|select/i.test(e.target.tagName)) return;
    var a = active();
    if (e.key === '+' || e.key === '=') { if (a) setZoom(a.getDist() / 1.25); }
    else if (e.key === '-' || e.key === '_') { if (a) setZoom(a.getDist() * 1.25); }
    else if (e.key === ']') setSize(size + 0.1);
    else if (e.key === '[') setSize(size - 0.1);
    else if (e.key === '0') setSize(1);           // 4.0.0 add-on: back to default size
  });
  // Double-click the "1.5x" readout to reset size too (mouse-only users).
  sz.val.addEventListener('dblclick', function () { setSize(1); });
  sz.val.title = 'Double-click to reset to 1.0\u00d7 (key: 0)';

  /* ── double-tap detector ──────────────────────────────────── */
  // Why our own detector instead of the 'dblclick' event: it works the same for
  // mouse, trackpad tap-to-click, touch and pen, and the renderers already
  // separate "click" from "drag" in their pointerup handlers -- so a double-tap
  // is simply two accepted clicks on the same node, close in time and space.
  var DOUBLE_MS = 400, DOUBLE_PX = 10;
  var lastTap = { key: null, t: 0, x: 0, y: 0 };

  function doubleTap(key, x, y) {
    var now = Date.now();
    var same = key !== null && key === lastTap.key &&
               now - lastTap.t <= DOUBLE_MS &&
               Math.abs(x - lastTap.x) <= DOUBLE_PX && Math.abs(y - lastTap.y) <= DOUBLE_PX;
    // After a double fires, reset so a third tap starts a new pair.
    lastTap = same ? { key: null, t: 0, x: 0, y: 0 } : { key: key, t: now, x: x, y: y };
    return same;
  }

  /* ── hint chip ────────────────────────────────────────────── */
  function hint(text) {
    hintEl.textContent = text;
    hintEl.classList.add('on');
    if (hintTimer) clearTimeout(hintTimer);
    hintTimer = setTimeout(function () { hintEl.classList.remove('on'); }, 2600);
  }

  /* ── KP watermark (4.0.0) ─────────────────────────────────────
     WHY: every project Kanak ships from 2026-09-22 carries his KP orbit logo.
     WHAT: (1) a small mark beside the VYUHA title, (2) the same mark stamped
     into every exported GIF (see exportGif in ds.js).
     HOW: the SVG is inlined here as a data: URI instead of loading
     media/logo-mark.svg by URL. A webview resource URL is a different origin,
     and drawing it onto a canvas would "taint" the canvas so getImageData()
     -- which the GIF encoder needs -- would throw. A data: SVG does not taint.
     tests/v4-test.js checks this string equals media/logo-mark.svg exactly. */
  var LOGO_SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="64" height="64" role="img"><title>Kanak Prabhakar logo mark</title><defs><linearGradient id="kpGrad" x1="8" y1="8" x2="56" y2="56" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#ff7a18"/><stop offset="0.55" stop-color="#e33d6f"/><stop offset="1" stop-color="#8e3dc9"/></linearGradient></defs><g fill="none" stroke="#c9d2e3" stroke-width="3.6"><path d="M58.85 39.82A27.01 5.976 6.09 0 1 34.56 43.26"/><path d="M21.53 41.51A27.01 5.976 6.09 0 1 5.15 34.18"/></g><circle cx="58.85" cy="39.82" r="1.8" fill="#c9d2e3"/><g fill="none" stroke="url(#kpGrad)" stroke-width="7" stroke-linejoin="round"><path d="M16 12V35.4M16 44.8V55M31 12L16.5 31M22.4 23.3L31.9 55M42 55V47.2M42 39.8V12H47.2A9.5 9.5 0 0 1 47.2 31H42"/></g><g fill="url(#kpGrad)"><circle cx="16" cy="12" r="3.5"/><circle cx="16" cy="55" r="3.5"/><circle cx="31" cy="12" r="3.5"/><circle cx="16.5" cy="31" r="3.5"/><circle cx="22.4" cy="23.3" r="3.5"/><circle cx="31.9" cy="55" r="3.5"/><circle cx="42" cy="55" r="3.5"/><circle cx="42" cy="31" r="3.5"/></g><circle cx="5.15" cy="34.18" r="4.6" fill="#ff7a18"/></svg>';
  var LOGO_URI = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(LOGO_SVG);
  var logoImg = null;
  try {
    logoImg = new Image();
    logoImg.alt = 'KP';
    logoImg.src = LOGO_URI;
  } catch (e) { logoImg = null; }                 // no Image(): no watermark, never a crash

  // Mark at the left of the top-left brand panel: visible, never overlaps a control.
  // It is a SIBLING of the title, not inside it: both renderers overwrite the
  // title's textContent on every frame/spec, which would delete a child image.
  var brand = document.querySelector('.brand');
  if (brand) {
    var mark = el('img', { id: 'kpMark', 'class': 'kpMark', alt: '', 'aria-hidden': 'true',
                           title: 'VYUHA by Kanak Prabhakar', src: LOGO_URI, width: '30', height: '30' });
    brand.insertBefore(mark, brand.firstChild);
  }

  /* ── public API (window.__vyuhaView) ──────────────────────── */
  window.__vyuhaView = {
    /**
     * A renderer registers once at start-up.
     * api = { min, max, home, getDist(), setDist(d), setSize(s) }
     * The current size is pushed immediately so both renderers start equal.
     */
    register: function (m, api) {
      renderers[m] = api;
      try { api.setSize(size); } catch (e) { /* ignore */ }
      if (m === mode()) { lastShown.dist = -1; }
    },
    /**
     * Called every frame by the awake renderer with its *goal* distance, so a
     * wheel, pinch, fit or reset moves the slider too (two-way sync). Only
     * writes the DOM when the value actually changed.
     */
    sync: function (m, d) {
      if (m !== mode() || dragging.zoom) return;
      if (lastShown.mode === m && Math.abs(lastShown.dist - d) < 1e-3) return;
      var api = renderers[m];
      if (!api) return;
      zoom.range.value = String(distToSlider(api, d));
      showZoom(api, d);
      lastShown.dist = d; lastShown.mode = m;
    },
    /** Initial size from the vyuha.nodeSize setting (sent in config). */
    setSize: setSize,
    getSize: function () { return size; },
    doubleTap: doubleTap,
    hint: hint,
    /** The KP logo as the raw SVG string and as a loaded <img> (for the GIF). */
    logoSvg: LOGO_SVG,
    logoImage: function () { return logoImg && logoImg.complete && logoImg.naturalWidth > 0 ? logoImg : null; }
  };

  // Paint the size readout once before anyone registers.
  setSize(size);
})();
