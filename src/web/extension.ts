/**
 * VYUHA Web Extension Entry Point
 * WHY: Desktop extension.ts uses Node APIs (fs, child_process, http, path, os, process).
 *      This file registers ONLY the commands/views that work in VS Code Web (vscode.dev).
 * WHAT: Activates graph editor, neural network visualization, trace playback, helpers.
 * WHERE: Loaded via "browser" field in package.json → dist/web/extension.js
 */
import * as vscode from 'vscode';
import { GraphEditorProvider, GraphView, ViewEvent } from '../panel';
import { layerAtLine, templateSpec } from '../spec';
import { LayerTree } from '../tree';
import { SourceHighlighter } from '../highlight';
import { fetchJson } from '../fetchLiveTrace';

let views: GraphView[] = [];
let active: GraphView | undefined;
let tree: LayerTree;
let diagnostics: vscode.DiagnosticCollection;
let status: vscode.StatusBarItem;
let out: vscode.OutputChannel;
let ctx: vscode.ExtensionContext;
let highlighter: SourceHighlighter;

export function activate(context: vscode.ExtensionContext) {
  ctx = context;
  tree = new LayerTree();
  highlighter = new SourceHighlighter();
  diagnostics = vscode.languages.createDiagnosticCollection('vyuha');
  out = vscode.window.createOutputChannel('VYUHA');

  status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  status.command = 'vyuha.showOutput';

  const treeView = vscode.window.createTreeView('vyuha.layers', { treeDataProvider: tree });
  const provider = new GraphEditorProvider(context.extensionUri, onEvent, track);

  context.subscriptions.push(
    diagnostics, status, treeView, out, highlighter,
    vscode.window.registerCustomEditorProvider(GraphEditorProvider.viewType, provider, {
      webviewOptions: { retainContextWhenHidden: true },
      supportsMultipleEditorsPerDocument: false
    }),

    /* Neural network / graph spec commands (work on web) */
    vscode.commands.registerCommand('vyuha.open', () => openActiveDocument(context)),
    vscode.commands.registerCommand('vyuha.runInference', () => active && active.run('run')),
    vscode.commands.registerCommand('vyuha.newInput', () => active && active.run('newInput')),
    vscode.commands.registerCommand('vyuha.tracePath', () => active && active.run('trace')),
    vscode.commands.registerCommand('vyuha.exportTrace', () => {
      if (active) active.run('export');
    }),
    vscode.commands.registerCommand('vyuha.fetchLiveTrace', fetchLiveTrace),
    vscode.commands.registerCommand('vyuha.newSpecFile', newSpecFile),
    vscode.commands.registerCommand('vyuha.focusLayer', (layer: number, unit?: number) => active && active.focus(layer, unit)),
    vscode.commands.registerCommand('vyuha.revealLayer', (node: { anchor?: { index: number } }) => {
      const i = node && node.anchor ? node.anchor.index : undefined;
      if (i !== undefined && active) void revealLayer(active, i);
    }),

    /* Helpers & examples (work on web — read from extension bundle) */
    vscode.commands.registerCommand('vyuha.addHelperLibrary', addHelperLibrary),
    vscode.commands.registerCommand('vyuha.openExample', openExample),

    /* GIF export (works on web — base64 from webview + vscode.workspace.fs.writeFile) */
    vscode.commands.registerCommand('vyuha.exportGif', () => {
      if (active) active.run('exportGif');
    }),

    vscode.workspace.onDidChangeTextDocument(debounce(e => {
      views.filter(v => v.uri.toString() === e.document.uri.toString()).forEach(v => v.refresh());
    }, 220)),

    vscode.workspace.onDidChangeConfiguration(e => {
      if (e.affectsConfiguration('vyuha')) {
        views.forEach(v => v.pushConfig());
      }
    }),

    vscode.window.onDidChangeTextEditorSelection(e => {
      if (!vscode.workspace.getConfiguration('vyuha').get<boolean>('syncCursor', true)) return;
      const view = views.find(v => v.uri.toString() === e.textEditor.document.uri.toString());
      if (!view || !view.state) return;
      const i = layerAtLine(view.state.anchors, e.selections[0].active.line);
      if (i >= 0) view.focus(i);
    })
  );

  void vscode.commands.executeCommand('setContext', 'vyuha.hasFrames', false);
}

export function deactivate() {
  views = [];
}

/* ══ Neural network / graph spec side ═════════════════════════════ */

function track(view: GraphView) {
  views.push(view);
  active = view;
}

function onEvent(e: ViewEvent) {
  switch (e.kind) {
    case 'graph': {
      active = e.view;
      diagnostics.set(e.state.uri, []);
      const labels = new Map<number, string[]>();
      e.state.spec.layers.forEach((l, i) => { if (l.labels) labels.set(i, l.labels); });
      tree.setGraph(e.state.uri, e.state.anchors, labels);
      break;
    }
    case 'invalid': {
      const line = e.line === undefined ? 0 : e.line;
      const d = new vscode.Diagnostic(
        new vscode.Range(line, 0, line, Number.MAX_SAFE_INTEGER),
        e.message,
        vscode.DiagnosticSeverity.Error
      );
      d.source = 'VYUHA';
      diagnostics.set(e.uri, [d]);
      tree.clear();
      break;
    }
    case 'select': {
      if (vscode.workspace.getConfiguration('vyuha').get<boolean>('revealOnClick', true)) {
        void revealLayer(e.view, e.layer);
      }
      break;
    }
    case 'reveal': {
      void revealLayer(e.view, e.layer, true);
      break;
    }
    case 'gif':
      void saveGif(e.b64, e.frames, e.view.uri.fsPath);
      break;
    case 'decision': {
      status.text = '$(circuit-board) ' + e.action + '  ' + (e.confidence * 100).toFixed(0) + '%';
      status.tooltip = 'Trace the path that produced this decision';
      status.show();
      break;
    }
    case 'activations': {
      tree.setActivations(e.values);
      break;
    }
    case 'export': {
      void saveTrace(e.payload, 'vyuha-trace.json');
      break;
    }
    case 'error': {
      vscode.window.showErrorMessage('The graph renderer stopped: ' + e.message);
      break;
    }
    case 'focus': {
      active = e.view;
      if (e.view.state) {
        const labels = new Map<number, string[]>();
        e.view.state.spec.layers.forEach((l, i) => { if (l.labels) labels.set(i, l.labels); });
        tree.setGraph(e.view.state.uri, e.view.state.anchors, labels);
      }
      break;
    }
    case 'dispose': {
      views = views.filter(v => v !== e.view);
      if (active === e.view) active = views[0];
      if (!views.length) tree.clear();
      break;
    }
  }
}

async function openActiveDocument(context: vscode.ExtensionContext) {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    vscode.window.showInformationMessage('Open a graph spec file first, then run this command.');
    return;
  }
  const doc = editor.document;
  const existing = views.find(v => v.uri.toString() === doc.uri.toString());
  if (existing) { existing.reveal(); return; }

  const panel = vscode.window.createWebviewPanel(
    'vyuha.panel',
    'VYUHA · ' + doc.uri.path.split('/').pop(),
    { viewColumn: vscode.ViewColumn.Beside, preserveFocus: false },
    { enableScripts: true, retainContextWhenHidden: true }
  );
  track(new GraphView(panel, doc, context.extensionUri, onEvent));
}

async function newSpecFile() {
  const doc = await vscode.workspace.openTextDocument({ language: 'json', content: templateSpec() });
  await vscode.window.showTextDocument(doc);
  void vscode.window.showInformationMessage(
    'Save this as a .vyuha.json file to open it in the graph view.',
    'Save as…'
  ).then(pick => { if (pick) void vscode.commands.executeCommand('workbench.action.files.saveAs'); });
}

async function revealLayer(view: GraphView, layerIndex: number, highlight = false) {
  const anchor = view.state ? view.state.anchors[layerIndex] : undefined;
  if (!anchor) return;
  if (highlight) { await highlighter.reveal(view.uri, anchor.line); return; }
  const doc = await vscode.workspace.openTextDocument(view.uri);
  await vscode.window.showTextDocument(doc, {
    viewColumn: vscode.ViewColumn.One,
    preserveFocus: true,
    selection: new vscode.Range(anchor.line, 0, anchor.line, 0)
  });
}

async function saveTrace(payload: unknown, defaultName: string) {
  const target = await vscode.window.showSaveDialog({
    filters: { JSON: ['json'] },
    saveLabel: 'Save',
    defaultUri: vscode.Uri.file(defaultName)
  });
  if (!target) return;
  await vscode.workspace.fs.writeFile(target, Buffer.from(JSON.stringify(payload, null, 2), 'utf8'));
  const open = await vscode.window.showInformationMessage('Saved.', 'Open');
  if (open) {
    const doc = await vscode.workspace.openTextDocument(target);
    await vscode.window.showTextDocument(doc);
  }
}

async function saveGif(b64: string, frames: number, source: string) {
  if (!b64) { vscode.window.showWarningMessage('The GIF came back empty — nothing was saved.'); return; }
  const base = source ? basename(source).replace(/(\.vyuha)?\.[^.]+$/, '') : 'vyuha';
  const target = await vscode.window.showSaveDialog({
    filters: { 'Animated GIF': ['gif'] },
    saveLabel: 'Save GIF',
    defaultUri: vscode.Uri.file(base + '-vyuha.gif')
  });
  if (!target) return;
  await vscode.workspace.fs.writeFile(target, Buffer.from(b64, 'base64'));
  const pick = await vscode.window.showInformationMessage(
    'Saved a ' + frames + '-frame GIF.', 'Reveal in Explorer');
  if (pick) void vscode.commands.executeCommand('revealFileInOS', target);
}

async function fetchLiveTrace() {
  const endpoint = vscode.workspace.getConfiguration('vyuha').get<string>('traceEndpoint', '').trim();
  if (!endpoint) {
    const pick = await vscode.window.showWarningMessage(
      'No trace endpoint is set. The graph runs its own forward pass until you point it at a model.',
      'Set endpoint'
    );
    if (pick) void vscode.commands.executeCommand('workbench.action.openSettings', 'vyuha.traceEndpoint');
    return;
  }
  if (!active) {
    vscode.window.showInformationMessage('Open a graph first.');
    return;
  }
  try {
    const body = await fetchJson(endpoint);
    active.applyTrace(body);
    vscode.window.setStatusBarMessage('$(cloud-download) Trace pulled from ' + endpoint, 2500);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    vscode.window.showErrorMessage('Could not read a trace from ' + endpoint + '. ' + msg);
  }
}

/* ══ Helper libraries and examples (read from extension bundle) ════════ */

const HELPERS = [
  { label: 'Python', detail: 'vyuha.py  ·  import vyuha', file: 'vyuha.py' },
  { label: 'JavaScript / Node', detail: 'vyuha.js  ·  require("./vyuha")', file: 'vyuha.js' },
  { label: 'Java', detail: 'Vyuha.java  ·  Vyuha.array(...)', file: 'Vyuha.java' },
  { label: 'C++', detail: 'vyuha.hpp  ·  header only', file: 'vyuha.hpp' },
  { label: 'C', detail: 'vyuha.h  ·  header only', file: 'vyuha.h' },
  { label: 'Go', detail: 'vyuha.go  ·  drop-in helper', file: 'vyuha.go' }
];

async function addHelperLibrary() {
  const pick = await vscode.window.showQuickPick(HELPERS, {
    placeHolder: 'Which language are you writing in?'
  });
  if (!pick) return;

  const folders = vscode.workspace.workspaceFolders;
  let dest: vscode.Uri | undefined;
  if (folders && folders.length === 1) {
    dest = vscode.Uri.joinPath(folders[0].uri, pick.file);
  } else {
    dest = await vscode.window.showSaveDialog({
      saveLabel: 'Add helper here',
      defaultUri: folders && folders.length
        ? vscode.Uri.joinPath(folders[0].uri, pick.file)
        : vscode.Uri.file(pick.file)
    });
  }
  if (!dest) return;

  try {
    const bytes = await vscode.workspace.fs.readFile(vscode.Uri.joinPath(ctx.extensionUri, 'lib', pick.file));
    await vscode.workspace.fs.writeFile(dest, bytes);
    const doc = await vscode.workspace.openTextDocument(dest);
    await vscode.window.showTextDocument(doc);
  } catch (err) {
    vscode.window.showErrorMessage('Could not add the helper: ' + (err instanceof Error ? err.message : String(err)));
  }
}

async function openExample() {
  const dir = vscode.Uri.joinPath(ctx.extensionUri, 'examples');
  let entries: [string, vscode.FileType][];
  try {
    entries = await vscode.workspace.fs.readDirectory(dir);
  } catch {
    vscode.window.showErrorMessage('The bundled examples are missing from this install.');
    return;
  }
  const files = entries.filter(x => x[1] === vscode.FileType.File).map(x => x[0]).sort();
  const pick = await vscode.window.showQuickPick(files, { placeHolder: 'Open an example' });
  if (!pick) return;
  const doc = await vscode.workspace.openTextDocument(vscode.Uri.joinPath(dir, pick));
  await vscode.window.showTextDocument(doc);
  if (!/\.(vyuha|netgraph)(\.json)?$/.test(pick)) {
    vscode.window.showInformationMessage('Open this spec in the graph view, or on desktop: Run and Visualize (Ctrl+Alt+V)');
  }
}

/* ══ Small utilities ══════════════════════════════════════════════ */

function basename(file: string): string {
  const s = file.lastIndexOf('/');
  const b = file.lastIndexOf('\\');
  const lastSep = Math.max(s, b);
  return file.slice(lastSep + 1);
}

function debounce<T>(fn: (arg: T) => void, ms: number): (arg: T) => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return (arg: T) => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => fn(arg), ms);
  };
}