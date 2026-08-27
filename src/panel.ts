import * as vscode from 'vscode';
import { GraphSpec, LayerAnchor, parseSpec } from './spec';
import { buildHtml, readConfig } from './runview';

export { readConfig };

export interface GraphState {
  uri: vscode.Uri;
  spec: GraphSpec;
  anchors: LayerAnchor[];
  unitCount: number;
}

export type ViewEvent =
  | { kind: 'graph'; view: GraphView; state: GraphState }
  | { kind: 'invalid'; view: GraphView; uri: vscode.Uri; message: string; line?: number }
  | { kind: 'select'; view: GraphView; layer: number; unit: number; label: string }
  | { kind: 'decision'; view: GraphView; action: string; confidence: number }
  | { kind: 'activations'; view: GraphView; values: Record<string, number> }
  | { kind: 'export'; view: GraphView; payload: unknown }
  | { kind: 'error'; view: GraphView; message: string }
  | { kind: 'focus'; view: GraphView }
  | { kind: 'dispose'; view: GraphView };

/** One webview bound to one spec document. */
export class GraphView {
  private ready = false;
  private pending: unknown[] = [];
  private disposables: vscode.Disposable[] = [];

  state: GraphState | undefined;

  constructor(
    private readonly panel: vscode.WebviewPanel,
    readonly document: vscode.TextDocument,
    private readonly extUri: vscode.Uri,
    private readonly onEvent: (e: ViewEvent) => void
  ) {
    panel.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(extUri, 'media')]
    };
    panel.webview.html = this.html(panel.webview);

    this.disposables.push(
      panel.webview.onDidReceiveMessage(m => this.receive(m)),
      panel.onDidChangeViewState(e => { if (e.webviewPanel.active) this.onEvent({ kind: 'focus', view: this }); })
    );
    panel.onDidDispose(() => {
      this.disposables.forEach(d => d.dispose());
      this.onEvent({ kind: 'dispose', view: this });
    });
  }

  get uri(): vscode.Uri { return this.document.uri; }
  get isActive(): boolean { return this.panel.active; }

  reveal() { this.panel.reveal(); }

  /** Re-reads the document, validates, and pushes the result to the webview. */
  refresh() {
    const res = parseSpec(this.document.getText());
    if (!res.ok) {
      this.state = undefined;
      this.post({ type: 'invalid', message: res.message });
      this.onEvent({ kind: 'invalid', view: this, uri: this.uri, message: res.message, line: res.line });
      return;
    }
    this.state = { uri: this.uri, spec: res.spec, anchors: res.anchors, unitCount: res.unitCount };
    this.post({ type: 'spec', spec: res.spec, config: readConfig() });
    this.onEvent({ kind: 'graph', view: this, state: this.state });
  }

  pushConfig() { this.post({ type: 'config', config: readConfig() }); }
  focus(layer: number, unit?: number) { this.post({ type: 'focus', layer, unit: unit ?? -1 }); }
  run(name: string) { this.post({ type: 'cmd', name }); }
  applyTrace(trace: unknown) { this.post({ type: 'trace', trace }); }

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
        this.refresh();
        break;
      case 'select':
        this.onEvent({ kind: 'select', view: this, layer: m.layer, unit: m.unit, label: String(m.label ?? '') });
        break;
      case 'decision':
        this.onEvent({ kind: 'decision', view: this, action: String(m.action ?? ''), confidence: Number(m.confidence) || 0 });
        break;
      case 'activations':
        this.onEvent({ kind: 'activations', view: this, values: m.values || {} });
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

  private html(webview: vscode.Webview): string {
    return buildHtml(webview, this.extUri, 'net');
  }
}

/** Binds .vyuha.json files to the graph view instead of the text editor. */
export class GraphEditorProvider implements vscode.CustomTextEditorProvider {
  static readonly viewType = 'vyuha.editor';

  constructor(
    private readonly extUri: vscode.Uri,
    private readonly onEvent: (e: ViewEvent) => void,
    private readonly track: (v: GraphView) => void
  ) {}

  resolveCustomTextEditor(document: vscode.TextDocument, panel: vscode.WebviewPanel): void {
    const view = new GraphView(panel, document, this.extUri, this.onEvent);
    this.track(view);
  }
}
