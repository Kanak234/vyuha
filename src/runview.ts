import * as vscode from 'vscode';
import { VFrame } from './protocol';

export function makeNonce(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let s = '';
  for (let i = 0; i < 32; i++) s += chars.charAt(Math.floor(Math.random() * chars.length));
  return s;
}

/**
 * One HTML document hosts both renderers. `media/bridge.js` owns the single
 * `acquireVsCodeApi()` handle (it may only be called once per webview) and
 * decides which renderer is awake; `main.js` draws networks and `ds.js` draws
 * data structures. Only the visible one runs a render loop.
 */
export function buildHtml(webview: vscode.Webview, extUri: vscode.Uri, mode: 'net' | 'ds'): string {
  const media = (f: string) => webview.asWebviewUri(vscode.Uri.joinPath(extUri, 'media', f));
  const nonce = makeNonce();
  const csp = [
    "default-src 'none'",
    'img-src ' + webview.cspSource + ' data:',
    'style-src ' + webview.cspSource + " 'unsafe-inline'",
    "script-src 'nonce-" + nonce + "'",
    'font-src ' + webview.cspSource
  ].join('; ');

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta http-equiv="Content-Security-Policy" content="${csp}" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<link rel="stylesheet" href="${media('style.css')}" />
<title>VYUHA</title>
</head>
<body data-mode="${mode}">
<div id="fail" role="alert"><p><b>WebGL didn't start</b>This view renders on the GPU. Turn on hardware acceleration, or run <code>code --ignore-gpu-blocklist</code>.</p></div>
<div id="invalid" role="alert"><p><b>Nothing to draw</b><span id="invalidMsg"></span></p></div>
<div id="labels" aria-hidden="true"></div>
<div id="tip" aria-hidden="true"></div>

<div id="ui">
  <div id="top">
    <div class="panel brand enter">
      <p class="eyebrow" id="metaNote">network</p>
      <h1 id="metaName">VYUHA</h1>
      <p class="sub"><b id="mLayers">0</b> layers · <b id="mNodes">0</b> units · <b id="mEdges">0</b> connections</p>
    </div>
    <div class="panel enter" id="stats">
      <div class="row"><span>fps</span><span id="sFps">—</span></div>
      <div class="row"><span>frame</span><span id="sMs">—</span></div>
      <div class="row"><span>draws</span><span id="sCalls">—</span></div>
      <div class="row"><span>pass</span><span id="sPass">idle</span></div>
    </div>
  </div>

  <div id="mid">
    <div class="panel enter" id="legend">
      <h2 id="legendTitle">Reading the graph</h2>
      <div id="legendNet">
        <div class="k"><i class="sw" style="background:#35f0a8"></i> positive weight</div>
        <div class="k"><i class="sw" style="background:#ff54cf"></i> negative weight</div>
        <div class="k"><i class="dot" style="background:#38e8ff"></i> input</div>
        <div class="k"><i class="dot" style="background:#ff54cf"></i> attention</div>
        <div class="k"><i class="dot" style="background:#8fa6c4"></i> add &amp; norm</div>
        <div class="k"><i class="dot" style="background:#35f0a8"></i> feed forward</div>
        <div class="k"><i class="dot" style="background:#ffc46b"></i> policy head</div>
      </div>
      <div id="legendDs">
        <div class="k"><i class="dot" style="background:#6aa8ff"></i> untouched</div>
        <div class="k"><i class="dot" style="background:#ffc46b"></i> being looked at</div>
        <div class="k"><i class="dot" style="background:#a382ff"></i> already seen</div>
        <div class="k"><i class="dot" style="background:#35f0a8"></i> settled</div>
        <div class="k"><i class="dot" style="background:#ff5470"></i> problem</div>
      </div>
    </div>
    <aside class="panel" id="inspect" aria-label="Detail">
      <header><h2 id="inspectTitle">Unit</h2><button class="btn" id="closeInspect">Close</button></header>
      <div class="body" id="inspectBody"></div>
    </aside>
  </div>

  <div class="panel enter" id="rail">
    <div id="railHead">
      <p class="t">Decision</p>
      <p class="v" id="decision">—</p>
      <p class="s" id="decisionSub">waiting for signal</p>
    </div>
    <div id="acts"></div>
  </div>

  <div class="panel enter" id="bar" role="toolbar" aria-label="Playback and view controls">
    <button class="btn on" id="bRun">Pause</button>
    <button class="btn" id="bNew">New input</button>
    <button class="btn" id="bTrace">Trace path</button>
    <div class="sep"></div>
    <div class="rng"><label for="rSpeed">Speed</label><input id="rSpeed" type="range" min="25" max="300" value="100"><b id="vSpeed">1.0×</b></div>
    <div class="sep"></div>
    <button class="btn on" id="bLabels">Labels</button>
    <button class="btn on" id="bBloom">Glow</button>
    <button class="btn on" id="bOrbit">Auto-orbit</button>
    <button class="btn" id="bReset">Reset view</button>
  </div>

  <div class="panel enter" id="timeline" role="toolbar" aria-label="Frame timeline">
    <button class="btn" id="tPrev" title="Previous frame">◀</button>
    <button class="btn on" id="tPlay" title="Play or pause">Play</button>
    <button class="btn" id="tNext" title="Next frame">▶</button>
    <div class="sep"></div>
    <input id="tScrub" type="range" min="0" max="0" value="0" aria-label="Frame" />
    <b id="tCount">0 / 0</b>
    <div class="sep"></div>
    <div class="rng"><label for="tSpeed">Hold</label><input id="tSpeed" type="range" min="30" max="1600" value="420"><b id="tSpeedV">420ms</b></div>
    <div class="sep"></div>
    <button class="btn on" id="tLabels">Labels</button>
    <button class="btn on" id="tGlow">Glow</button>
    <button class="btn" id="tReset">Reset view</button>
  </div>

  <div class="panel enter" id="caption">
    <p class="ct" id="capTitle">—</p>
    <p class="cn" id="capNote"></p>
  </div>

  <div id="waiting" class="panel">
    <h2>Waiting for your program</h2>
    <p>Print one line per frame from any language:</p>
    <pre><code>@vyuha {"kind":"array","array":[5,3,8],"active":[1]}</code></pre>
    <p class="dim">Run <b>VYUHA: Add Helper Library</b> for a ready-made helper in your language, or <b>VYUHA: Open an Example</b> to see one working.</p>
  </div>
</div>

<script nonce="${nonce}" src="${media('three.min.js')}"></script>
<script nonce="${nonce}" src="${media('bridge.js')}"></script>
<script nonce="${nonce}" src="${media('main.js')}"></script>
<script nonce="${nonce}" src="${media('ds.js')}"></script>
</body>
</html>`;
}

export function readConfig() {
  const c = vscode.workspace.getConfiguration('vyuha');
  return {
    speed: c.get<number>('speed', 1),
    glow: c.get<boolean>('glow', true),
    autoOrbit: c.get<boolean>('autoOrbit', true),
    labels: c.get<boolean>('labels', true),
    frameDelay: c.get<number>('frameDelay', 420)
  };
}

/* ── the run view ───────────────────────────────────────────── */

export type RunEvent =
  | { kind: 'ready'; view: RunView }
  | { kind: 'frame'; view: RunView; index: number }
  | { kind: 'select'; view: RunView; id: string; label: string; line?: number }
  | { kind: 'error'; view: RunView; message: string }
  | { kind: 'export'; view: RunView; payload: unknown }
  | { kind: 'dispose'; view: RunView };

/** A panel bound to a program run rather than to a document. */
export class RunView {
  private ready = false;
  private pending: unknown[] = [];
  private disposables: vscode.Disposable[] = [];
  frames: VFrame[] = [];
  sourceFile = '';

  constructor(
    private readonly panel: vscode.WebviewPanel,
    extUri: vscode.Uri,
    private readonly onEvent: (e: RunEvent) => void
  ) {
    panel.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(extUri, 'media')]
    };
    panel.webview.html = buildHtml(panel.webview, extUri, 'ds');
    this.disposables.push(panel.webview.onDidReceiveMessage(m => this.receive(m)));
    panel.onDidDispose(() => {
      this.disposables.forEach(d => d.dispose());
      this.onEvent({ kind: 'dispose', view: this });
    });
  }

  get isAlive(): boolean { return !!this.panel; }

  reveal(preserveFocus = true) { this.panel.reveal(undefined, preserveFocus); }

  setTitle(t: string) { this.panel.title = t; }

  /** Begin a new run: clear the old timeline and show the waiting state. */
  beginRun(file: string, command: string) {
    this.frames = [];
    this.sourceFile = file;
    this.post({ type: 'runStart', file, command, config: readConfig() });
  }

  addFrame(frame: VFrame, index: number) {
    this.frames.push(frame);
    this.post({ type: 'frame', frame, index });
  }

  /** A program can also emit a full network spec; hand that to the other renderer. */
  showNet(spec: unknown) {
    this.post({ type: 'spec', spec, config: readConfig() });
  }

  endRun(code: number | null, elapsedMs: number, autoPlay: boolean) {
    this.post({ type: 'runEnd', code, elapsedMs, autoPlay, total: this.frames.length });
  }

  warn(message: string) { this.post({ type: 'warn', message }); }
  gotoFrame(i: number) { this.post({ type: 'goto', index: i }); }
  command(name: string) { this.post({ type: 'cmd', name }); }
  pushConfig() { this.post({ type: 'config', config: readConfig() }); }

  private post(msg: unknown) {
    if (!this.ready) { this.pending.push(msg); return; }
    void this.panel.webview.postMessage(msg);
  }

  private receive(m: any) {
    switch (m && m.type) {
      case 'ready':
        this.ready = true;
        this.pending.forEach(p => void this.panel.webview.postMessage(p));
        this.pending = [];
        this.onEvent({ kind: 'ready', view: this });
        break;
      case 'frameShown':
        this.onEvent({ kind: 'frame', view: this, index: Number(m.index) || 0 });
        break;
      case 'selectNode':
        this.onEvent({
          kind: 'select', view: this,
          id: String(m.id ?? ''), label: String(m.label ?? ''),
          line: typeof m.line === 'number' ? m.line : undefined
        });
        break;
      case 'export':
        this.onEvent({ kind: 'export', view: this, payload: m.payload });
        break;
      case 'error':
        this.onEvent({ kind: 'error', view: this, message: String(m.message ?? '') });
        break;
      default:
        break;
    }
  }
}
