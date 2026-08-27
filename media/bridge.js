/**
 * acquireVsCodeApi() may be called exactly once per webview, but this document
 * hosts two independent renderers. The bridge takes that single handle and
 * hands both of them a postMessage they can use, and owns the question of
 * which renderer is currently awake.
 */
(function () {
  'use strict';

  var api = (typeof acquireVsCodeApi === 'function') ? acquireVsCodeApi() : null;
  var listeners = [];

  function setMode(mode) {
    if (mode !== 'net' && mode !== 'ds') return;
    if (document.body.dataset.mode === mode) return;
    document.body.dataset.mode = mode;
    listeners.forEach(function (fn) {
      try { fn(mode); } catch (e) { /* a listener must not break the switch */ }
    });
    window.dispatchEvent(new Event('resize'));
  }

  window.__vyuha = {
    /** Both renderers post through here. */
    postMessage: function (m) { if (api) api.postMessage(m); },
    mode: function () { return document.body.dataset.mode || 'net'; },
    /** True when the calling renderer owns the screen right now. */
    isActive: function (mode) { return (document.body.dataset.mode || 'net') === mode; },
    setMode: setMode,
    onModeChange: function (fn) { listeners.push(fn); },
    /** Surface a crash instead of leaving a black rectangle behind. */
    fail: function (message) {
      if (api) api.postMessage({ type: 'error', message: String(message) });
    }
  };

  window.addEventListener('error', function (ev) {
    var where = (ev.filename || '').split('/').pop();
    window.__vyuha.fail((ev.message || 'unknown error') + (where ? '  (' + where + ':' + ev.lineno + ')' : ''));
  });
})();
