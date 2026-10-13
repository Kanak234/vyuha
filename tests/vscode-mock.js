/*
 * test/vscode-mock.js — VS Code API ka chhota "nakli" version, Node tests ke liye.
 *
 * WHY:   Extension ka `activate()`, commands aur webview messages ko bina VS Code
 *        khole test karna hai (Windows/Linux/macOS teeno par same). Asli VS Code
 *        ke andar wala test CI mein alag se chalta hai; yeh mock har machine par
 *        second-mein chalta hai.
 * WHAT:  Zaroori API ka real-ish behaviour (documents, edits, commands, webview
 *        postMessage) + baaki har cheez ke liye Proxy stub (kabhi crash nahi).
 * USE:   const vs = require('./vscode-mock').install();  // require('vscode') ab yeh deta hai
 */
'use strict';

const fs = require('fs');
const path = require('path');
const Module = require('module');

function install(opts = {}) {
  const config = Object.assign({}, opts.config || {});
  const commands = new Map();
  const messages = [];            // showInformation/Warning/Error ke saare messages
  const panels = [];
  const terminals = [];
  const docs = new Map();         // uri string → doc
  const listeners = {};
  const on = name => (fn) => { (listeners[name] = listeners[name] || []).push(fn); return { dispose() {} }; };
  const fire = (name, ...a) => (listeners[name] || []).forEach(f => f(...a));

  class Position { constructor(l, c) { this.line = l; this.character = c; } }
  class Range { constructor(a, b, c, d) { if (a instanceof Position) { this.start = a; this.end = b; } else { this.start = new Position(a, b); this.end = new Position(c, d); } } }
  class Uri {
    constructor(scheme, p) { this.scheme = scheme; this.fsPath = p; this.path = p; }
    static file(p) { return new Uri('file', p); }
    static parse(s) { return new Uri(s.split(':')[0], s); }
    static joinPath(u, ...p) { return Uri.file(path.join(u.fsPath, ...p)); }
    toString() { return this.scheme + '://' + this.fsPath; }
    with() { return this; }
  }
  class EventEmitter { constructor() { this.l = []; this.event = f => { this.l.push(f); return { dispose() {} }; }; } fire(x) { this.l.forEach(f => f(x)); } dispose() {} }
  class WorkspaceEdit { constructor() { this.ops = []; } replace(uri, range, text) { this.ops.push({ uri, range, text }); } insert(uri, pos, text) { this.ops.push({ uri, range: new Range(pos, pos), text }); } }
  class Diagnostic { constructor(range, message, severity) { Object.assign(this, { range, message, severity }); } }
  class CodeLens { constructor(range, command) { this.range = range; this.command = command; } }
  class CodeAction { constructor(title, kind) { this.title = title; this.kind = kind; } }
  class ThemeColor { constructor(id) { this.id = id; } }
  class ThemeIcon { constructor(id) { this.id = id; } }
  class Disposable { constructor(f) { this.f = f; } dispose() { this.f && this.f(); } static from() { return new Disposable(); } }

  function makeDoc(uri, text, languageId) {
    const doc = {
      uri, languageId: languageId || langOf(uri.fsPath), isDirty: false, isUntitled: uri.scheme === 'untitled',
      fileName: uri.fsPath, version: 1,
      _text: text,
      getText() { return this._text; },
      get lineCount() { return this._text.split('\n').length; },
      lineAt(n) { const line = this._text.split('\n')[n] || ''; return { text: line, range: new Range(n, 0, n, line.length) }; },
      positionAt(off) { const pre = this._text.slice(0, off).split('\n'); return new Position(pre.length - 1, pre[pre.length - 1].length); },
      offsetAt(pos) { const ls = this._text.split('\n'); let o = 0; for (let i = 0; i < pos.line; i++) o += ls[i].length + 1; return o + pos.character; },
      save() { fs.writeFileSync(this.uri.fsPath, this._text); this.isDirty = false; return Promise.resolve(true); }
    };
    docs.set(uri.toString(), doc);
    return doc;
  }
  function langOf(p) { return ({ '.java': 'java', '.c': 'c', '.cpp': 'cpp', '.py': 'python', '.js': 'javascript', '.json': 'json' })[path.extname(p || '')] || 'plaintext'; }

  const stub = (name) => new Proxy(function () {}, {
    get(t, k) { if (k === 'then') return undefined; if (k === Symbol.toPrimitive) return () => name; return stub(name + '.' + String(k)); },
    apply() { return stub(name + '()'); }
  });

  const window = {
    activeTextEditor: undefined,
    visibleTextEditors: [],
    createOutputChannel: (n) => ({ name: n, lines: [], appendLine(s) { this.lines.push(s); }, append(s) { this.lines.push(s); }, clear() { this.lines = []; }, show() {}, dispose() {} }),
    createStatusBarItem: () => ({ text: '', show() {}, hide() {}, dispose() {} }),
    // opts.answer(message, buttons) → test decide karta hai user ne kaunsa button dabaya
    showInformationMessage: (m, ...b) => { messages.push({ level: 'info', m }); return Promise.resolve(opts.answer ? opts.answer(m, b.filter(x => typeof x === 'string')) : undefined); },
    showWarningMessage: (m, ...b) => { messages.push({ level: 'warn', m }); return Promise.resolve(opts.answer ? opts.answer(m, b.filter(x => typeof x === 'string')) : undefined); },
    showErrorMessage: (m, ...b) => { messages.push({ level: 'error', m }); return Promise.resolve(opts.answer ? opts.answer(m, b.filter(x => typeof x === 'string')) : undefined); },
    showOpenDialog: () => Promise.resolve(opts.openDialog ? opts.openDialog() : undefined),
    setStatusBarMessage: (m) => { messages.push({ level: 'status', m }); return { dispose() {} }; },
    showQuickPick: (items) => Promise.resolve(opts.quickPick ? opts.quickPick(items) : undefined),
    showInputBox: () => Promise.resolve(undefined),
    showTextDocument: (doc) => { const ed = { document: doc, selection: { active: new Position(0, 0) } }; window.activeTextEditor = ed; return Promise.resolve(ed); },
    createWebviewPanel: (viewType, title) => {
      const p = {
        viewType, title, posted: [], visible: true,
        webview: {
          html: '', cspSource: 'mock:',
          asWebviewUri: (u) => u,
          postMessage(m) { p.posted.push(m); return Promise.resolve(true); },
          onDidReceiveMessage(f) { p._recv = f; return { dispose() {} }; },
          options: {}
        },
        reveal() {}, dispose() { p._dispose && p._dispose(); },
        onDidDispose(f) { p._dispose = f; return { dispose() {} }; },
        onDidChangeViewState() { return { dispose() {} }; },
        send(m) { return p._recv && p._recv(m); }
      };
      panels.push(p);
      return p;
    },
    createTerminal: (o) => { const t = { name: (o && o.name) || o, options: o, sent: [], show() {}, sendText(s) { this.sent.push(s); }, dispose() { this.disposed = true; } }; terminals.push(t); return t; },
    onDidChangeActiveTextEditor: on('activeEditor'),
    onDidCloseTerminal: on('closeTerminal'),
    registerWebviewViewProvider: () => ({ dispose() {} }),
    withProgress: (o, task) => task({ report() {} }, { isCancellationRequested: false, onCancellationRequested() {} }),
    get terminals() { return terminals; }
  };

  const workspace = {
    get textDocuments() { return [...docs.values()]; },
    workspaceFolders: opts.workspaceFolders,
    getConfiguration: (section) => ({
      get: (k, d) => { const key = section ? section + '.' + k : k; return key in config ? config[key] : d; },
      update: (k, v) => { config[(section ? section + '.' : '') + k] = v; return Promise.resolve(); },
      has: (k) => ((section ? section + '.' : '') + k) in config
    }),
    openTextDocument: (arg) => {
      if (arg && arg.fsPath !== undefined) {
        const existing = docs.get(arg.toString());
        if (existing) return Promise.resolve(existing);
        return Promise.resolve(makeDoc(arg, fs.readFileSync(arg.fsPath, 'utf8')));
      }
      if (typeof arg === 'string') return workspace.openTextDocument(Uri.file(arg));
      const u = new Uri('untitled', 'Untitled-' + (docs.size + 1));
      return Promise.resolve(makeDoc(u, (arg && arg.content) || '', arg && arg.language));
    },
    applyEdit: (we) => {
      for (const op of we.ops) {
        const d = docs.get(op.uri.toString());
        if (!d) continue;
        const a = d.offsetAt(op.range.start), b = d.offsetAt(op.range.end);
        d._text = d._text.slice(0, a) + op.text + d._text.slice(b);
        d.isDirty = true; d.version++;
        fire('change', { document: d, contentChanges: [] });
      }
      return Promise.resolve(true);
    },
    onDidOpenTextDocument: on('open'), onDidSaveTextDocument: on('save'), onDidChangeTextDocument: on('change'),
    onDidCloseTextDocument: on('close'), onDidChangeConfiguration: on('config'), onDidChangeWorkspaceFolders: on('folders'),
    createFileSystemWatcher: () => ({ onDidChange() {}, onDidCreate() {}, onDidDelete() {}, dispose() {} }),
    fs: { stat: (u) => Promise.resolve(fs.statSync(u.fsPath)) }
  };

  const vscode = {
    version: '1.95.0',
    Position, Range, Uri, EventEmitter, WorkspaceEdit, Diagnostic, CodeLens, CodeAction, ThemeColor, ThemeIcon, Disposable,
    DiagnosticSeverity: { Error: 0, Warning: 1, Information: 2, Hint: 3 },
    CodeActionKind: { QuickFix: 'quickfix', Refactor: 'refactor' },
    ViewColumn: { One: 1, Two: 2, Beside: -2, Active: -1 },
    StatusBarAlignment: { Left: 1, Right: 2 },
    ProgressLocation: { Notification: 15, Window: 10 },
    ConfigurationTarget: { Global: 1, Workspace: 2 },
    TreeItemCollapsibleState: { None: 0, Collapsed: 1, Expanded: 2 },
    TreeItem: class { constructor(label, s) { this.label = label; this.collapsibleState = s; } },
    window, workspace,
    commands: {
      registerCommand: (id, fn) => { commands.set(id, fn); return { dispose() {} }; },
      executeCommand: (id, ...a) => (commands.has(id) ? Promise.resolve(commands.get(id)(...a)) : Promise.resolve(undefined)),
      getCommands: () => Promise.resolve([...commands.keys()])
    },
    languages: {
      createDiagnosticCollection: () => { const m = new Map(); return { set: (u, l) => m.set(u.toString(), l), get: (u) => m.get(u.toString()), delete: (u) => m.delete(u.toString()), clear: () => m.clear(), dispose() {}, _m: m }; },
      registerCodeLensProvider: (sel, p) => { vscode._lens = p; return { dispose() {} }; },
      registerCodeActionsProvider: (sel, p) => { vscode._actions = p; return { dispose() {} }; },
      registerHoverProvider: () => ({ dispose() {} }),
      registerCompletionItemProvider: () => ({ dispose() {} })
    },
    env: { clipboard: { _t: '', writeText(t) { this._t = t; return Promise.resolve(); }, readText() { return Promise.resolve(this._t); } }, openExternal: () => Promise.resolve(true), appName: 'mock', language: 'en' },
    extensions: { getExtension: () => undefined },
    debug: stub('debug'), tasks: stub('tasks'),
    _commands: commands, _messages: messages, _panels: panels, _terminals: terminals, _docs: docs, _fire: fire, _config: config
  };

  // Jo API mock mein nahi (createTreeView, registerCustomEditorProvider, ...) —
  // ek no-op function do jo disposable-jaisa stub lautaye. Tests crash nahi hote.
  const fallback = (obj, name) => new Proxy(obj, {
    get(t, k) { if (k in t) return t[k]; if (typeof k === 'symbol') return undefined; return (..._a) => Object.assign(stub(name + '.' + String(k)), { dispose() {} }); }
  });
  vscode.window = fallback(window, 'window');
  vscode.workspace = fallback(workspace, 'workspace');
  vscode.languages = fallback(vscode.languages, 'languages');
  vscode.commands = fallback(vscode.commands, 'commands');
  const root = fallback(vscode, 'vscode');

  const origLoad = Module._load;
  Module._load = function (request, parent, isMain) {
    if (request === 'vscode') return root;
    return origLoad.apply(this, arguments);
  };
  return root;
}

/** Fake ExtensionContext */
function context(extPath) {
  const store = new Map();
  const gsPath = fs.mkdtempSync(path.join(require('os').tmpdir(), 'ext-gs-'));
  return {
    extensionPath: extPath,
    extensionUri: { fsPath: extPath, scheme: 'file', path: extPath, toString() { return 'file://' + extPath; } },
    subscriptions: [],
    globalStorageUri: { fsPath: gsPath, scheme: 'file', path: gsPath },
    globalStoragePath: gsPath,
    storageUri: { fsPath: gsPath, scheme: 'file', path: gsPath },
    globalState: { get: (k, d) => (store.has(k) ? store.get(k) : d), update: (k, v) => { store.set(k, v); return Promise.resolve(); }, keys: () => [...store.keys()] },
    workspaceState: { get: (k, d) => d, update: () => Promise.resolve() },
    asAbsolutePath: (p) => path.join(extPath, p),
    extension: { packageJSON: JSON.parse(fs.readFileSync(path.join(extPath, 'package.json'), 'utf8')) }
  };
}

module.exports = { install, context };
