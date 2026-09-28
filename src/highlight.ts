import * as vscode from 'vscode';

/**
 * VYUHA 4.0.0 — "double-tap a sphere, see its line".
 *
 * WHY THIS FILE EXISTS
 *   Before 4.0.0 a click only moved the cursor. On a long file the cursor lands
 *   off-screen or blends in, so the tester saw nothing happen. This class makes
 *   the jump obvious: it opens the file, centres the line, and paints the whole
 *   line (background + left border + a mark in the scrollbar ruler).
 *
 * WHO CALLS IT (flow)
 *   media/ds.js   --revealLine-->  runview.ts  --'reveal' event-->  extension.ts
 *   media/main.js --reveal------>  panel.ts    --'reveal' event-->  extension.ts
 *   extension.ts then calls SourceHighlighter.reveal(uri, line).
 *
 * LIFETIME OF A HIGHLIGHT
 *   It stays until the user moves the cursor by mouse/keyboard in that editor,
 *   edits the document, or another line is revealed -- long enough to read, and
 *   never left behind as clutter.
 */
export class SourceHighlighter implements vscode.Disposable {
  // One decoration type for the whole session. Colours come from theme colours
  // contributed in package.json, so light/dark/high-contrast themes can adapt
  // and users can override them via workbench.colorCustomizations.
  private readonly deco = vscode.window.createTextEditorDecorationType({
    isWholeLine: true,
    backgroundColor: new vscode.ThemeColor('vyuha.sourceLineBackground'),
    borderColor: new vscode.ThemeColor('vyuha.sourceLineBorder'),
    borderStyle: 'solid',
    borderWidth: '0 0 0 3px',                       // left bar only
    overviewRulerColor: new vscode.ThemeColor('vyuha.sourceLineBorder'),
    overviewRulerLane: vscode.OverviewRulerLane.Full
  });

  // The editor currently carrying the highlight, so we can clear exactly it.
  private editor: vscode.TextEditor | undefined;
  private readonly subs: vscode.Disposable[] = [];

  constructor() {
    this.subs.push(
      // Clear when the USER moves the cursor. Our own reveal also changes the
      // selection, but with kind = Command/undefined, which we ignore -- otherwise
      // the highlight would clear itself the instant it appeared.
      vscode.window.onDidChangeTextEditorSelection(e => {
        if (e.textEditor !== this.editor) return;
        const k = e.kind;
        if (k === vscode.TextEditorSelectionChangeKind.Keyboard || k === vscode.TextEditorSelectionChangeKind.Mouse) {
          this.clear();
        }
      }),
      // Any edit shifts lines, so the highlighted line may no longer be the one.
      vscode.workspace.onDidChangeTextDocument(e => {
        if (this.editor && e.document === this.editor.document && e.contentChanges.length) this.clear();
      })
    );
  }

  /**
   * Open `uri`, put the cursor at the start of `line`, scroll it to the middle
   * if it is off-screen, and highlight it.
   * @param line 0-based line number (callers convert from the protocol's 1-based)
   * @returns the line actually shown (clamped to the file), or undefined on failure
   */
  async reveal(uri: vscode.Uri, line: number): Promise<number | undefined> {
    let doc: vscode.TextDocument;
    try {
      doc = await vscode.workspace.openTextDocument(uri);
    } catch {
      return undefined;                              // file moved or deleted since the run
    }
    // Clamp: a stale frame may point past the end of a file that was edited.
    const l = Math.max(0, Math.min(line, doc.lineCount - 1));
    const range = new vscode.Range(l, 0, l, 0);

    // Column One = the editor group the user normally codes in; the VYUHA panel
    // opens "Beside", so this keeps code left / picture right.
    // preserveFocus keeps keyboard focus in the graph, so Space/arrows still work.
    const editor = await vscode.window.showTextDocument(doc, {
      viewColumn: vscode.ViewColumn.One,
      preserveFocus: true,
      selection: range
    });
    editor.revealRange(range, vscode.TextEditorRevealType.InCenterIfOutsideViewport);

    this.clear();                                    // one highlight at a time
    editor.setDecorations(this.deco, [range]);
    this.editor = editor;
    return l;
  }

  /** Remove the highlight from whichever editor has it. */
  clear() {
    if (this.editor) {
      try { this.editor.setDecorations(this.deco, []); } catch { /* editor already closed */ }
      this.editor = undefined;
    }
  }

  dispose() {
    this.clear();
    this.subs.forEach(s => s.dispose());
    this.deco.dispose();
  }
}
