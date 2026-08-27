import * as vscode from 'vscode';
import * as http from 'http';
import * as https from 'https';
import * as path from 'path';
import * as fs from 'fs';
import { GraphEditorProvider, GraphView, ViewEvent } from './panel';
import { RunView, RunEvent } from './runview';
import { layerAtLine, templateSpec } from './spec';
import { LayerTree } from './tree';
import { RunSession, commandFor, knownExtensions, stdinFileFor, planTerminalRun, LogTail } from './runner';
import { Payload, VFrame, parseLine } from './protocol';
import { analyzeSource, stagesFor, autoFrame, initialState, AutoState, CodeGraph, Stage } from './codegraph';

let views: GraphView[] = [];
let active: GraphView | undefined;
let runView: RunView | undefined;
let session: RunSession | undefined;
let lastRunFile: string | undefined;
let tree: LayerTree;
let diagnostics: vscode.DiagnosticCollection;
let status: vscode.StatusBarItem;
let out: vscode.OutputChannel;
let ctx: vscode.ExtensionContext;

export function activate(context: vscode.ExtensionContext) {
  ctx = context;
  tree = new LayerTree();
  diagnostics = vscode.languages.createDiagnosticCollection('vyuha');
  out = vscode.window.createOutputChannel('VYUHA');

  status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  status.command = 'vyuha.showOutput';

  const treeView = vscode.window.createTreeView('vyuha.layers', { treeDataProvider: tree });
  const provider = new GraphEditorProvider(context.extensionUri, onEvent, track);

  context.subscriptions.push(
    diagnostics, status, treeView, out,
    vscode.window.registerCustomEditorProvider(GraphEditorProvider.viewType, provider, {
      webviewOptions: { retainContextWhenHidden: true },
      supportsMultipleEditorsPerDocument: false
    }),

    /* running any program */
    vscode.commands.registerCommand('vyuha.runAndVisualize', (target?: vscode.Uri) => runAndVisualize(target)),
    vscode.commands.registerCommand('vyuha.rerun', () => {
      if (lastRunFile) void runAndVisualize(vscode.Uri.file(lastRunFile));
      else vscode.window.showInformationMessage('Nothing has been run yet.');
    }),
    vscode.commands.registerCommand('vyuha.stopRun', stopRun),
    vscode.commands.registerCommand('vyuha.showOutput', () => out.show(true)),
    vscode.commands.registerCommand('vyuha.addHelperLibrary', addHelperLibrary),
    vscode.commands.registerCommand('vyuha.openExample', openExample),

    /* timeline */
    vscode.commands.registerCommand('vyuha.playPause', () => runView && runView.command('playPause')),
    vscode.commands.registerCommand('vyuha.stepNext', () => runView && runView.command('next')),
    vscode.commands.registerCommand('vyuha.stepPrev', () => runView && runView.command('prev')),
    vscode.commands.registerCommand('vyuha.gotoFrame', (i: number) => runView && runView.gotoFrame(i)),

    /* neural network side */
    vscode.commands.registerCommand('vyuha.open', () => openActiveDocument(context)),
    vscode.commands.registerCommand('vyuha.runInference', () => active && active.run('run')),
    vscode.commands.registerCommand('vyuha.newInput', () => active && active.run('newInput')),
    vscode.commands.registerCommand('vyuha.tracePath', () => active && active.run('trace')),
    vscode.commands.registerCommand('vyuha.exportTrace', () => {
      if (runView && runView.frames.length) runView.command('export');
      else if (active) active.run('export');
    }),
    vscode.commands.registerCommand('vyuha.fetchLiveTrace', fetchLiveTrace),
    vscode.commands.registerCommand('vyuha.newSpecFile', newSpecFile),
    vscode.commands.registerCommand('vyuha.focusLayer', (layer: number, unit?: number) => active && active.focus(layer, unit)),
    vscode.commands.registerCommand('vyuha.revealLayer', (node: { anchor?: { index: number } }) => {
      const i = node && node.anchor ? node.anchor.index : undefined;
      if (i !== undefined && active) void revealLayer(active, i);
    }),

    vscode.workspace.onDidChangeTextDocument(debounce(e => {
      views.filter(v => v.uri.toString() === e.document.uri.toString()).forEach(v => v.refresh());
    }, 220)),

    vscode.workspace.onDidChangeConfiguration(e => {
      if (e.affectsConfiguration('vyuha')) {
        views.forEach(v => v.pushConfig());
        if (runView) runView.pushConfig();
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
  stopEverything();
  views = [];
}

/** Runner settings, read fresh on each run so edits take effect at once. */
function readRunConfig() {
  const c = vscode.workspace.getConfiguration('vyuha');
  return {
    runners: c.get<Record<string, string>>('runners', {}) || {},
    runCwd: c.get<string>('runCwd', 'file'),
    runTimeout: c.get<number>('runTimeout', 120),
    maxFrames: c.get<number>('maxFrames', 2000),
    autoPlay: c.get<boolean>('autoPlay', true),
    frameDelay: c.get<number>('frameDelay', 420),
    clearOutputOnRun: c.get<boolean>('clearOutputOnRun', true),
    stdinFile: c.get<string>('stdinFile', ''),
    runInTerminal: c.get<boolean>('runInTerminal', true),
    autoVisualize: c.get<boolean>('autoVisualize', true)
  };
}

/* ══ run a program in any language ═════════════════════════════ */

/** Everything one execution needs to keep track of. */
interface RunCtx {
  file: string;
  command: string;
  cwd: string;
  view: RunView;
  cfg: ReturnType<typeof readRunConfig>;
  frames: VFrame[];
  cg: CodeGraph;
  stages: Stage[];
  auto: AutoState;
  autoFrames: number;
  programFrames: number;
  phase: 'compile' | 'run' | 'done';
  outIndex: number;
}

let ctxNow: RunCtx | undefined;

const MAX_AUTO_FRAMES = 60;

async function runAndVisualize(target?: vscode.Uri) {
  const editor = vscode.window.activeTextEditor;
  const uri = target || (editor ? editor.document.uri : undefined);
  if (!uri || uri.scheme !== 'file') {
    vscode.window.showInformationMessage('Open a source file, then run VYUHA on it.');
    return;
  }

  // Save first, so the program on disk is the one in the editor.
  const doc = vscode.workspace.textDocuments.find(d => d.uri.toString() === uri.toString());
  if (doc && doc.isDirty) await doc.save();

  const cfg = readRunConfig();
  const file = uri.fsPath;
  const command = commandFor(file, cfg.runners);
  if (!command) {
    await offerRunner(file, cfg.runners);
    return;
  }

  stopEverything();

  const folders = vscode.workspace.workspaceFolders;
  const cwd = cfg.runCwd === 'workspace' && folders && folders.length
    ? folders[0].uri.fsPath
    : path.dirname(file);

  ensureRunView();
  const view = runView!;
  view.setTitle('VYUHA · ' + path.basename(file));
  view.beginRun(file, command);
  view.reveal(true);

  lastRunFile = file;
  tree.setFrames([], file);
  void vscode.commands.executeCommand('setContext', 'vyuha.hasFrames', false);

  if (cfg.clearOutputOnRun) out.clear();
  out.appendLine('$ ' + command);
  out.appendLine('  in ' + cwd + '\n');

  status.text = '$(sync~spin) VYUHA running';
  status.tooltip = 'Show the program output';
  status.show();

  /*
   * Read the source before anything runs. A program that never prints an
   * @vyuha line still has a shape — functions, loops, branches, the places it
   * prints from — and that shape, joined to the toolchain stages, is what the
   * run animates. So "hello world" draws something too.
   */
  let source = '';
  try { source = fs.readFileSync(file, 'utf8'); } catch { /* drawn as an empty file */ }
  const cg = analyzeSource(file, source);
  const stages = stagesFor(command, cg.language);

  const ctx: RunCtx = {
    file, command, cwd, view, cfg,
    frames: [],
    cg, stages,
    auto: initialState(),
    autoFrames: 0,
    programFrames: 0,
    phase: 'compile',
    outIndex: 0
  };
  ctxNow = ctx;

  if (cfg.autoVisualize) {
    ctx.auto.stages['s:src'] = 'done';
    const first = stages.find(s => s.id === 's:compile' || s.id === 's:parse');
    if (first) {
      ctx.auto.stages[first.id] = 'active';
      pushAuto(ctx, first.id === 's:compile' ? 'compiling ' + path.basename(file) : 'parsing ' + path.basename(file));
    } else {
      ctx.auto.stages['s:run'] = 'active';
      pushAuto(ctx, 'starting');
    }
  }

  const inputFile = stdinFileFor(file, cfg.stdinFile || undefined);
  if (inputFile) out.appendLine('  input from ' + inputFile + '\n');

  if (cfg.runInTerminal) startInTerminal(ctx, inputFile);
  else startInBackground(ctx, inputFile);
}

/* ── the two ways to run ───────────────────────────────────────── */

/**
 * The default. The program gets a real terminal, so it can be typed into and
 * its prompts appear as they are written; VYUHA reads a transcript of the same
 * session from a log file.
 */
function startInTerminal(ctx: RunCtx, inputFile?: string) {
  const plan = planTerminalRun(ctx.command, ctx.cwd, inputFile);
  cleanupFiles = plan.cleanup;

  terminal = vscode.window.terminals.find(t => t.name === TERMINAL_NAME && !t.exitStatus)
    || vscode.window.createTerminal({ name: TERMINAL_NAME, cwd: ctx.cwd });
  terminal.show(true);
  terminal.sendText(plan.send, true);
  out.appendLine('[vyuha] running in the terminal — type into it if the program asks for input\n');

  tail = new LogTail(
    plan.logPath,
    line => onLine(ctx, line, false),
    code => finishRun(ctx, code, null)
  );
  tail.start();

  if (ctx.cfg.runTimeout > 0) {
    termTimer = setTimeout(() => {
      if (ctxNow !== ctx || ctx.phase === 'done') return;
      out.appendLine('[vyuha] still running after ' + ctx.cfg.runTimeout + 's — press Ctrl+Alt+X to stop it');
    }, ctx.cfg.runTimeout * 1000);
  }
}

/** The quiet way: no terminal, output captured straight from the process. */
function startInBackground(ctx: RunCtx, inputFile?: string) {
  session = new RunSession(ctx.file, ctx.command, ctx.cwd, ctx.cfg.maxFrames, ctx.cfg.runTimeout, {
    onOutput: text => {
      out.append(text);
      text.split(/\r?\n/).forEach(l => { if (l.trim()) noteOutput(ctx, l); });
    },
    onFrame: (payload: Payload) => applyPayload(ctx, payload),
    onWarning: message => {
      out.appendLine('[vyuha] ' + message);
      ctx.view.warn(message);
    },
    onExit: (code, signal, elapsedMs) => finishRun(ctx, code, elapsedMs)
  }, inputFile);
  session.start();
}

/* ── shared handling ───────────────────────────────────────────── */

/** One line of program output, from either runner. */
function onLine(ctx: RunCtx, line: string, isErr: boolean) {
  if (ctxNow !== ctx) return;
  const res = parseLine(line);
  if (res === null) {
    out.appendLine((isErr ? '! ' : '') + line);
    if (line.trim()) noteOutput(ctx, line);
    return;
  }
  if ('error' in res) {
    out.appendLine('[vyuha] ' + res.error);
    ctx.view.warn(res.error);
    return;
  }
  applyPayload(ctx, res.payload);
}

function applyPayload(ctx: RunCtx, payload: Payload) {
  if (payload.type === 'net') { ctx.view.showNet(payload.spec); return; }
  if (ctx.frames.length >= ctx.cfg.maxFrames) return;
  ctx.programFrames++;
  ctx.frames.push(payload.frame);
  ctx.view.addFrame(payload.frame, ctx.frames.length - 1);
  if (ctx.frames.length === 1) void vscode.commands.executeCommand('setContext', 'vyuha.hasFrames', true);
  tree.setFrames(ctx.frames, ctx.file);
}

/**
 * A plain output line moves the picture along: the first one means the program
 * is past its toolchain and running, and each one after lights the next print
 * statement in the source. Once the program starts drawing itself, VYUHA stops
 * guessing and gets out of the way.
 */
function noteOutput(ctx: RunCtx, line: string) {
  if (!ctx.cfg.autoVisualize || ctx.programFrames > 0 || ctx.autoFrames >= MAX_AUTO_FRAMES) return;

  if (ctx.phase === 'compile') {
    if (/\b(error|fatal|undefined reference|cannot find|Traceback)\b/i.test(line)) {
      for (const s of ctx.stages) {
        if (s.id === 's:compile' || s.id === 's:parse') ctx.auto.stages[s.id] = 'error';
      }
      pushAuto(ctx, trim(line), undefined);
      return;
    }
    ctx.phase = 'run';
    for (const s of ctx.stages) {
      if (s.id === 's:compile' || s.id === 's:parse' || s.id === 's:link') ctx.auto.stages[s.id] = 'done';
    }
    ctx.auto.stages['s:run'] = 'active';
    ctx.auto.code[ctx.cg.entry] = 'active';
    pushAuto(ctx, 'running ' + labelOf(ctx, ctx.cg.entry));
  }

  ctx.auto.outCount++;
  ctx.auto.stages['s:out'] = 'active';

  const id = ctx.cg.outputs[ctx.outIndex];
  if (id) {
    for (const k of Object.keys(ctx.auto.code)) {
      if (k.startsWith('o:') && ctx.auto.code[k] === 'active') ctx.auto.code[k] = 'visited';
    }
    ctx.auto.code[id] = 'active';
    const node = ctx.cg.nodes.find(n => n.id === id);
    if (node && node.parent) ctx.auto.code[node.parent] = 'active';
    ctx.outIndex = Math.min(ctx.outIndex + 1, ctx.cg.outputs.length - 1);
    pushAuto(ctx, trim(line), node ? node.line : undefined);
  } else {
    pushAuto(ctx, trim(line));
  }
}

function labelOf(ctx: RunCtx, id: string): string {
  const n = ctx.cg.nodes.find(x => x.id === id);
  return n ? n.label : 'the program';
}

function trim(s: string): string {
  const t = s.trim();
  return t.length > 90 ? t.slice(0, 88) + '…' : t;
}

/** Build one auto frame from the current state and put it on the timeline. */
function pushAuto(ctx: RunCtx, note?: string, line?: number) {
  if (!ctx.cfg.autoVisualize) return;
  ctx.auto.note = note;
  ctx.auto.line = line;
  ctx.auto.title = path.basename(ctx.file);
  const frame = autoFrame(ctx.cg, ctx.stages, ctx.auto);
  ctx.autoFrames++;
  ctx.frames.push(frame);
  ctx.view.addFrame(frame, ctx.frames.length - 1);
  if (ctx.frames.length === 1) void vscode.commands.executeCommand('setContext', 'vyuha.hasFrames', true);
  tree.setFrames(ctx.frames, ctx.file);
}

function finishRun(ctx: RunCtx, code: number | null, elapsedMs: number | null) {
  if (ctxNow !== ctx || ctx.phase === 'done') return;
  ctx.phase = 'done';

  if (tail) { tail.finish(); tail = undefined; }
  if (termTimer) { clearTimeout(termTimer); termTimer = undefined; }
  removeScratch();

  if (ctx.cfg.autoVisualize && ctx.programFrames === 0) {
    for (const s of ctx.stages) {
      if (ctx.auto.stages[s.id] !== 'error') ctx.auto.stages[s.id] = 'done';
    }
    if (code !== 0 && code !== null) ctx.auto.stages['s:run'] = 'error';
    for (const k of Object.keys(ctx.auto.code)) ctx.auto.code[k] = 'done';
    pushAuto(ctx, code === 0 || code === null ? 'finished' : 'exited with code ' + code);
  }

  const took = elapsedMs === null ? '' : ' in ' + (elapsedMs / 1000).toFixed(2) + 's';
  out.appendLine('\n[vyuha] ' + describeExit(code, null) + took +
    ' · ' + ctx.frames.length + ' frames' +
    (ctx.programFrames ? '' : ' (drawn from the source)'));

  ctx.view.endRun(code, elapsedMs === null ? 0 : elapsedMs, ctx.cfg.autoPlay);

  status.text = ctx.frames.length
    ? '$(run-all) VYUHA · ' + ctx.frames.length + ' frames'
    : '$(warning) VYUHA · nothing to draw';
  status.tooltip = 'Show the program output';

  if (!ctx.programFrames) {
    out.appendLine('[vyuha] this picture was read from your source. For a data structure view, print lines like:');
    out.appendLine('        @vyuha {"array":[3,1,2],"active":[0]}');
  }
}

/* ── stopping and cleanup ──────────────────────────────────────── */

const TERMINAL_NAME = 'VYUHA';
let terminal: vscode.Terminal | undefined;
let tail: LogTail | undefined;
let termTimer: NodeJS.Timeout | undefined;
let cleanupFiles: string[] = [];

function stopEverything() {
  if (session && session.running) session.stop();
  if (tail) { tail.stop(); tail = undefined; }
  if (termTimer) { clearTimeout(termTimer); termTimer = undefined; }
  removeScratch();
}

function removeScratch() {
  for (const f of cleanupFiles) {
    try { fs.unlinkSync(f); } catch { /* already gone, or still being written */ }
  }
  cleanupFiles = [];
}

function stopRun() {
  let stopped = false;
  if (session && session.running) { session.stop(); stopped = true; }
  if (tail) {
    // Ctrl+C in the terminal is what actually ends a program running there.
    if (terminal && !terminal.exitStatus) { terminal.sendText('\u0003', false); }
    tail.finish();
    tail = undefined;
    stopped = true;
    if (ctxNow) finishRun(ctxNow, null, null);
  }
  if (stopped) out.appendLine('\n[vyuha] stopped by request');
  else vscode.window.showInformationMessage('No program is running.');
}

async function offerRunner(file: string, overrides: Record<string, string>) {
  const ext = path.extname(file) || '(no extension)';
  const pick = await vscode.window.showWarningMessage(
    'VYUHA has no run command for ' + ext + ' yet. Add one and it behaves like every other language.',
    'Add a command', 'See the built-in list'
  );
  if (pick === 'Add a command') {
    void vscode.commands.executeCommand('workbench.action.openSettings', 'vyuha.runners');
  } else if (pick === 'See the built-in list') {
    out.appendLine('[vyuha] built-in extensions: ' +
      knownExtensions(overrides).map(e => '.' + e).join('  '));
    out.show(true);
  }
}

function describeExit(code: number | null, signal: string | null): string {
  if (signal) return 'stopped (' + signal + ')';
  if (code === 0) return 'finished';
  if (code === null) return 'stopped';
  return 'exited with code ' + code;
}

function ensureRunView() {
  if (runView) { runView.reveal(true); return; }
  const panel = vscode.window.createWebviewPanel(
    'vyuha.run',
    'VYUHA',
    { viewColumn: vscode.ViewColumn.Beside, preserveFocus: true },
    { enableScripts: true, retainContextWhenHidden: true }
  );
  runView = new RunView(panel, ctx.extensionUri, onRunEvent);
}

function onRunEvent(e: RunEvent) {
  switch (e.kind) {
    case 'frame':
      tree.highlightFrame(e.index);
      break;
    case 'select':
      if (e.line !== undefined && lastRunFile) void revealSourceLine(lastRunFile, e.line);
      break;
    case 'export':
      void saveTrace(e.payload, 'vyuha-frames.json');
      break;
    case 'error':
      vscode.window.showErrorMessage('The VYUHA renderer stopped: ' + e.message);
      break;
    case 'dispose':
      runView = undefined;
      void vscode.commands.executeCommand('setContext', 'vyuha.hasFrames', false);
      break;
    default:
      break;
  }
}

async function revealSourceLine(file: string, line: number) {
  try {
    const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(file));
    const l = Math.max(0, Math.min(line - 1, doc.lineCount - 1));
    await vscode.window.showTextDocument(doc, {
      viewColumn: vscode.ViewColumn.One,
      preserveFocus: true,
      selection: new vscode.Range(l, 0, l, 0)
    });
  } catch { /* the file may have moved; not worth an error toast */ }
}

/* ══ helper libraries and examples ═════════════════════════════ */

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
    vscode.window.showInformationMessage('Now run it: VYUHA: Run and Visualize  (Ctrl+Alt+V)');
  }
}

/* ══ neural network side ═══════════════════════════════════════ */

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

async function revealLayer(view: GraphView, layerIndex: number) {
  const anchor = view.state ? view.state.anchors[layerIndex] : undefined;
  if (!anchor) return;
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
    const body = await getJson(endpoint);
    active.applyTrace(body);
    vscode.window.setStatusBarMessage('$(cloud-download) Trace pulled from ' + endpoint, 2500);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    vscode.window.showErrorMessage('Could not read a trace from ' + endpoint + '. ' + msg);
  }
}

function getJson(url: string): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let mod: typeof http | typeof https;
    try {
      mod = new URL(url).protocol === 'https:' ? https : http;
    } catch {
      reject(new Error('That is not a valid URL.'));
      return;
    }
    const req = mod.get(url, { timeout: 4000 }, res => {
      if (!res.statusCode || res.statusCode >= 400) {
        res.resume();
        reject(new Error('The server answered ' + res.statusCode + '.'));
        return;
      }
      let raw = '';
      res.setEncoding('utf8');
      res.on('data', c => { raw += c; });
      res.on('end', () => {
        try { resolve(JSON.parse(raw)); }
        catch { reject(new Error('The response was not JSON.')); }
      });
    });
    req.on('timeout', () => { req.destroy(new Error('The request timed out.')); });
    req.on('error', reject);
  });
}

function debounce<T>(fn: (arg: T) => void, ms: number): (arg: T) => void {
  let timer: NodeJS.Timeout | undefined;
  return (arg: T) => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => fn(arg), ms);
  };
}
