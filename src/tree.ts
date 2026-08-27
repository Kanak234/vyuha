import * as vscode from 'vscode';
import { LayerAnchor, LayerKind } from './spec';
import { VFrame } from './protocol';

const KIND_ICON: Record<LayerKind, string> = {
  input: 'debug-start',
  dense: 'symbol-array',
  attn: 'sparkle',
  norm: 'symbol-ruler',
  ffn: 'symbol-method',
  relu: 'graph-line',
  output: 'target'
};

const KIND_TEXT: Record<LayerKind, string> = {
  input: 'input',
  dense: 'projection',
  attn: 'attention',
  norm: 'residual + norm',
  ffn: 'feed forward',
  relu: 'hidden · relu',
  output: 'policy head'
};

const UNIT_CAP = 48;

export class LayerNode extends vscode.TreeItem {
  constructor(public readonly anchor: LayerAnchor, public readonly uri: vscode.Uri) {
    super(anchor.name, vscode.TreeItemCollapsibleState.Collapsed);
    this.description = KIND_TEXT[anchor.kind] + ' · ' + anchor.n;
    this.tooltip = new vscode.MarkdownString(
      '**' + anchor.name + '**\n\n`' + anchor.id + '` · ' + KIND_TEXT[anchor.kind] +
      '\n\n' + anchor.n + ' units · line ' + (anchor.line + 1)
    );
    this.iconPath = new vscode.ThemeIcon(KIND_ICON[anchor.kind]);
    this.contextValue = 'layer';
    this.command = {
      command: 'vyuha.focusLayer',
      title: 'Focus in graph',
      arguments: [anchor.index]
    };
  }
}

export class UnitNode extends vscode.TreeItem {
  constructor(
    public readonly layerIndex: number,
    public readonly unitIndex: number,
    label: string,
    activation: number | undefined
  ) {
    super(label, vscode.TreeItemCollapsibleState.None);
    if (activation !== undefined) this.description = activation.toFixed(3);
    this.iconPath = new vscode.ThemeIcon('circle-small-filled');
    this.contextValue = 'unit';
    this.command = {
      command: 'vyuha.focusLayer',
      title: 'Focus in graph',
      arguments: [layerIndex, unitIndex]
    };
  }
}

/** One moment captured from a running program. */
export class FrameNode extends vscode.TreeItem {
  constructor(public readonly index: number, frame: VFrame, current: boolean) {
    super(String(index + 1).padStart(3, '0') + '  ' + (frame.title || frame.kind), vscode.TreeItemCollapsibleState.None);
    this.description = frame.note || (frame.nodes.length + ' nodes');
    this.tooltip = new vscode.MarkdownString(
      '**frame ' + (index + 1) + '** · ' + frame.kind +
      '\n\n' + frame.nodes.length + ' nodes · ' + frame.edges.length + ' edges' +
      (frame.note ? '\n\n' + frame.note : '')
    );
    this.iconPath = new vscode.ThemeIcon(current ? 'debug-stackframe' : 'debug-stackframe-dot');
    this.contextValue = 'frame';
    this.command = { command: 'vyuha.gotoFrame', title: 'Go to frame', arguments: [index] };
  }
}

type Node = LayerNode | UnitNode | FrameNode;

export class LayerTree implements vscode.TreeDataProvider<Node> {
  private emitter = new vscode.EventEmitter<Node | undefined>();
  readonly onDidChangeTreeData = this.emitter.event;

  private anchors: LayerAnchor[] = [];
  private uri: vscode.Uri | undefined;
  private labels = new Map<number, string[]>();
  private activations = new Map<string, number>();
  private frames: VFrame[] = [];
  private currentFrame = -1;

  /** A program run replaces the layer listing with its frame timeline. */
  setFrames(frames: VFrame[], _file: string) {
    this.frames = frames;
    if (this.currentFrame >= frames.length) this.currentFrame = frames.length - 1;
    this.emitter.fire(undefined);
  }

  highlightFrame(index: number) {
    if (index === this.currentFrame) return;
    this.currentFrame = index;
    this.emitter.fire(undefined);
  }

  setGraph(uri: vscode.Uri | undefined, anchors: LayerAnchor[], labels: Map<number, string[]>) {
    this.uri = uri;
    this.anchors = anchors;
    this.labels = labels;
    this.activations.clear();
    this.emitter.fire(undefined);
  }

  setActivations(values: Record<string, number>) {
    this.activations.clear();
    for (const k of Object.keys(values)) this.activations.set(k, values[k]);
    this.emitter.fire(undefined);
  }

  clear() {
    this.uri = undefined;
    this.frames = [];
    this.currentFrame = -1;
    this.anchors = [];
    this.labels.clear();
    this.activations.clear();
    this.emitter.fire(undefined);
  }

  get isEmpty(): boolean { return this.anchors.length === 0 && this.frames.length === 0; }

  getTreeItem(el: Node): vscode.TreeItem { return el; }

  getChildren(el?: Node): Node[] {
    // A live run takes the sidebar; the spec listing returns when it ends.
    if (this.frames.length) {
      if (el) return [];
      return this.frames.map((f, i) => new FrameNode(i, f, i === this.currentFrame));
    }
    if (!this.uri) return [];
    if (!el) return this.anchors.map(a => new LayerNode(a, this.uri as vscode.Uri));
    if (el instanceof LayerNode) {
      const a = el.anchor;
      const names = this.labels.get(a.index);
      const count = Math.min(a.n, UNIT_CAP);
      const out: Node[] = [];
      for (let i = 0; i < count; i++) {
        const label = (names && names[i]) || (a.id + '·' + String(i).padStart(2, '0'));
        out.push(new UnitNode(a.index, i, label, this.activations.get(a.index + ':' + i)));
      }
      if (a.n > UNIT_CAP) {
        const more = new UnitNode(a.index, -1, (a.n - UNIT_CAP) + ' more units', undefined);
        more.iconPath = new vscode.ThemeIcon('ellipsis');
        more.command = undefined;
        out.push(more);
      }
      return out;
    }
    return [];
  }
}
