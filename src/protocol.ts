/**
 * The VYUHA wire protocol.
 *
 * A program in ANY language draws itself by printing one line to stdout:
 *
 *     @vyuha {"kind":"tree","nodes":[...],"edges":[...]}
 *
 * That is the whole contract. Every helper library in lib/ is a convenience
 * wrapper around that print. Because the only requirement is "write a line to
 * stdout", a language does not need a binding to be supported.
 *
 * The payload is deliberately forgiving: this module accepts several friendly
 * shorthands and normalises all of them into one shape before the renderer
 * ever sees them, so the drawing code stays simple.
 */

export type DsKind = 'list' | 'tree' | 'graph' | 'array' | 'stack' | 'queue' | 'matrix';

export const DS_KINDS: DsKind[] = ['list', 'tree', 'graph', 'array', 'stack', 'queue', 'matrix'];

/** normal · active (being looked at) · visited · done (settled) · error */
export type NodeState = 'normal' | 'active' | 'visited' | 'done' | 'error';

const STATES: NodeState[] = ['normal', 'active', 'visited', 'done', 'error'];

export interface VNode {
  id: string;
  label: string;
  state: NodeState;
  /** Numeric value, used for bar heights in array/matrix views. */
  value?: number;
  /** Explicit grid position for matrix/array kinds. */
  row?: number;
  col?: number;
  /** Explicit world position; overrides the layout when present. */
  x?: number;
  y?: number;
  z?: number;
  note?: string;
  group?: string;
}

export interface VEdge {
  from: string;
  to: string;
  label?: string;
  state: NodeState;
  directed: boolean;
  weight?: number;
}

/** One moment in time. A run is a list of these. */
export interface VFrame {
  kind: DsKind;
  title?: string;
  note?: string;
  nodes: VNode[];
  edges: VEdge[];
  /** Source line the emitting statement sat on, when the program reports it. */
  line?: number;
}

export type Payload =
  | { type: 'ds'; frame: VFrame }
  | { type: 'net'; spec: unknown };

const LINE_RE = /^\s*(?:@|#{1,2}|\/\/)\s*vyuha\b\s*:?\s*(.+?)\s*$/i;

/** True when this stdout line carries a payload rather than ordinary output. */
export function isPayloadLine(line: string): boolean {
  return LINE_RE.test(line);
}

/**
 * Pull a payload out of one stdout line.
 * Returns null for ordinary program output, and for malformed payloads —
 * a broken print should never kill the run.
 */
export function parseLine(line: string): { payload: Payload } | { error: string } | null {
  const m = LINE_RE.exec(line);
  if (!m) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(m[1]);
  } catch {
    return { error: 'that line is marked @vyuha but the rest of it is not JSON' };
  }
  try {
    return { payload: normalise(raw) };
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
}

/** Turn any accepted shorthand into one canonical payload. */
export function normalise(raw: unknown): Payload {
  // @vyuha [5, 3, 8]  ->  an array frame
  if (Array.isArray(raw)) {
    return { type: 'ds', frame: fromArray(raw, {}) };
  }
  if (!raw || typeof raw !== 'object') {
    throw new Error('a payload must be a JSON object or array');
  }
  const o = raw as Record<string, any>;

  // A neural network spec routes to the other renderer.
  if (o.type === 'net' || Array.isArray(o.layers)) {
    return { type: 'net', spec: o.spec ?? o };
  }

  const meta = {
    title: str(o.title ?? o.name),
    note: str(o.note ?? o.message ?? o.step),
    line: num(o.line)
  };

  if (Array.isArray(o.array) || Array.isArray(o.values)) {
    return { type: 'ds', frame: fromArray(o.array ?? o.values, o, meta) };
  }
  if (Array.isArray(o.matrix) || Array.isArray(o.grid)) {
    return { type: 'ds', frame: fromMatrix(o.matrix ?? o.grid, o, meta) };
  }
  if (Array.isArray(o.list) || Array.isArray(o.stack) || Array.isArray(o.queue)) {
    const kind: DsKind = o.list ? 'list' : o.stack ? 'stack' : 'queue';
    return { type: 'ds', frame: fromSequence(o.list ?? o.stack ?? o.queue, kind, o, meta) };
  }
  if (o.tree && typeof o.tree === 'object') {
    return { type: 'ds', frame: fromNested(o.tree, o, meta) };
  }
  if (o.adjacency && typeof o.adjacency === 'object') {
    return { type: 'ds', frame: fromAdjacency(o.adjacency, o, meta) };
  }
  if (Array.isArray(o.nodes)) {
    return { type: 'ds', frame: fromNodes(o.nodes, o.edges ?? o.links ?? [], o, meta) };
  }
  throw new Error(
    'a payload needs one of: nodes, array, matrix, list, stack, queue, tree, adjacency, or layers'
  );
}

/* ── builders ───────────────────────────────────────────────── */

interface Meta { title?: string; note?: string; line?: number }

function fromArray(values: any[], o: Record<string, any>, meta: Meta = {}): VFrame {
  const active = idSet(o.active ?? o.highlight);
  const done = idSet(o.done ?? o.sorted);
  const kind: DsKind = pickKind(o.kind, 'array');
  const nodes = values.map((v, i) => {
    const id = String(i);
    return cleanNode({
      id,
      label: label(v),
      value: num(v),
      state: stateFor(id, i, active, done, o),
      row: 0,
      col: i
    });
  });
  return frame(kind, nodes, [], meta);
}

function fromMatrix(rows: any[], o: Record<string, any>, meta: Meta = {}): VFrame {
  const active = idSet(o.active ?? o.highlight);
  const done = idSet(o.done);
  const nodes: VNode[] = [];
  rows.forEach((row: any, r: number) => {
    const cells = Array.isArray(row) ? row : [row];
    cells.forEach((v: any, c: number) => {
      const id = r + ',' + c;
      nodes.push(cleanNode({
        id,
        label: label(v),
        value: num(v),
        state: active.has(id) ? 'active' : done.has(id) ? 'done' : 'normal',
        row: r,
        col: c
      }));
    });
  });
  return frame(pickKind(o.kind, 'matrix'), nodes, [], meta);
}

function fromSequence(values: any[], kind: DsKind, o: Record<string, any>, meta: Meta = {}): VFrame {
  const active = idSet(o.active ?? o.highlight);
  const done = idSet(o.done);
  const nodes = values.map((v, i) => {
    const id = String(i);
    return cleanNode({
      id,
      label: label(v),
      value: num(v),
      state: stateFor(id, i, active, done, o),
      col: i
    });
  });
  const edges: VEdge[] = [];
  for (let i = 0; i + 1 < nodes.length; i++) {
    edges.push({ from: nodes[i].id, to: nodes[i + 1].id, state: 'normal', directed: kind !== 'queue' ? true : true });
  }
  return frame(pickKind(o.kind, kind), nodes, edges, meta);
}

/** { "value": 8, "children": [ ... ] } or { "value": 8, "left": {...}, "right": {...} } */
function fromNested(root: any, o: Record<string, any>, meta: Meta = {}): VFrame {
  const nodes: VNode[] = [];
  const edges: VEdge[] = [];
  let auto = 0;
  const walk = (n: any, parent: string | null, slot?: string) => {
    if (n === null || n === undefined) return;
    const id = n.id !== undefined ? String(n.id) : 't' + auto++;
    nodes.push(cleanNode({
      id,
      label: label(n.label ?? n.value ?? n.key ?? id),
      value: num(n.value ?? n.key),
      state: asState(n.state),
      note: str(n.note)
    }));
    if (parent !== null) edges.push({ from: parent, to: id, label: slot, state: asState(n.edgeState), directed: true });
    const kids: Array<[any, string | undefined]> = Array.isArray(n.children)
      ? n.children.map((c: any) => [c, undefined] as [any, string | undefined])
      : [[n.left, 'L'], [n.right, 'R']];
    kids.forEach(pair => walk(pair[0], id, pair[1]));
  };
  walk(root, null);
  if (!nodes.length) throw new Error('the tree payload has no nodes');
  return frame(pickKind(o.kind, 'tree'), nodes, edges, meta);
}

/** { "a": ["b","c"], "b": [["c", 4]] } — neighbour lists, optionally weighted. */
function fromAdjacency(adj: Record<string, any>, o: Record<string, any>, meta: Meta = {}): VFrame {
  const active = idSet(o.active ?? o.highlight);
  const done = idSet(o.done ?? o.visited);
  const ids = new Set<string>(Object.keys(adj));
  const edges: VEdge[] = [];
  for (const [from, list] of Object.entries(adj)) {
    for (const entry of toArray(list)) {
      const to = Array.isArray(entry) ? String(entry[0]) : String(entry);
      const weight = Array.isArray(entry) ? num(entry[1]) : undefined;
      ids.add(to);
      edges.push({
        from, to, state: 'normal',
        directed: o.directed !== false,
        weight,
        label: weight === undefined ? undefined : String(weight)
      });
    }
  }
  const nodes = [...ids].map(id => cleanNode({
    id,
    label: id,
    state: active.has(id) ? 'active' : done.has(id) ? 'done' : 'normal'
  }));
  return frame(pickKind(o.kind, 'graph'), nodes, edges, meta);
}

function fromNodes(rawNodes: any[], rawEdges: any, o: Record<string, any>, meta: Meta = {}): VFrame {
  const active = idSet(o.active ?? o.highlight);
  const done = idSet(o.done ?? o.visited);
  const nodes = rawNodes.map((n, i) => {
    if (n === null || typeof n !== 'object') {
      const id = String(i);
      return cleanNode({ id, label: label(n), value: num(n), state: stateFor(id, i, active, done, o) });
    }
    const id = String(n.id ?? i);
    return cleanNode({
      id,
      label: label(n.label ?? n.value ?? id),
      value: num(n.value ?? n.weight),
      state: n.state ? asState(n.state) : (active.has(id) ? 'active' : done.has(id) ? 'done' : 'normal'),
      row: num(n.row), col: num(n.col),
      x: num(n.x), y: num(n.y), z: num(n.z),
      note: str(n.note), group: str(n.group)
    });
  });
  const known = new Set(nodes.map(n => n.id));
  const edges: VEdge[] = toArray(rawEdges).map((e: any) => {
    const from = String(Array.isArray(e) ? e[0] : (e.from ?? e.source ?? e.u));
    const to = String(Array.isArray(e) ? e[1] : (e.to ?? e.target ?? e.v));
    const weight = Array.isArray(e) ? num(e[2]) : num(e.weight);
    return {
      from, to,
      state: Array.isArray(e) ? 'normal' as NodeState : asState(e.state),
      directed: Array.isArray(e) ? true : e.directed !== false,
      weight,
      label: Array.isArray(e) ? undefined : str(e.label)
    };
  }).filter(e => known.has(e.from) && known.has(e.to));
  return frame(pickKind(o.kind, 'graph'), nodes, edges, meta);
}

/* ── small helpers ──────────────────────────────────────────── */

function frame(kind: DsKind, nodes: VNode[], edges: VEdge[], meta: Meta): VFrame {
  const out: VFrame = { kind, nodes, edges };
  if (meta.title) out.title = meta.title;
  if (meta.note) out.note = meta.note;
  if (meta.line !== undefined) out.line = meta.line;
  return out;
}

/** Drop undefined keys so posted messages stay small and diffable. */
function cleanNode(n: Partial<VNode> & { id: string; label: string }): VNode {
  const out: any = { id: n.id, label: n.label, state: n.state ?? 'normal' };
  (['value', 'row', 'col', 'x', 'y', 'z', 'note', 'group'] as const).forEach(k => {
    if (n[k] !== undefined) out[k] = n[k];
  });
  return out as VNode;
}

function pickKind(v: unknown, fallback: DsKind): DsKind {
  const s = String(v ?? '').toLowerCase();
  if ((DS_KINDS as string[]).includes(s)) return s as DsKind;
  if (s === 'linkedlist' || s === 'linked_list' || s === 'll') return 'list';
  if (s === 'bst' || s === 'binarytree' || s === 'heap') return 'tree';
  if (s === 'network' || s === 'digraph') return 'graph';
  return fallback;
}

function stateFor(
  id: string, index: number,
  active: Set<string>, done: Set<string>,
  o: Record<string, any>
): NodeState {
  if (active.has(id) || active.has(String(index))) return 'active';
  if (done.has(id) || done.has(String(index))) return 'done';
  if (o.states && o.states[index]) return asState(o.states[index]);
  return 'normal';
}

function asState(v: unknown): NodeState {
  const s = String(v ?? 'normal').toLowerCase();
  if (s === 'current' || s === 'compare') return 'active';
  if (s === 'sorted' || s === 'final') return 'done';
  if (s === 'seen') return 'visited';
  return (STATES as string[]).includes(s) ? (s as NodeState) : 'normal';
}

function idSet(v: unknown): Set<string> {
  return new Set(toArray(v).map(x => String(x)));
}

function toArray(v: unknown): any[] {
  if (Array.isArray(v)) return v;
  if (v === undefined || v === null) return [];
  return [v];
}

function label(v: unknown): string {
  if (v === null) return 'null';
  if (v === undefined) return '';
  if (typeof v === 'number') return Number.isInteger(v) ? String(v) : v.toFixed(2);
  if (typeof v === 'object') return JSON.stringify(v).slice(0, 24);
  return String(v).slice(0, 24);
}

function num(v: unknown): number | undefined {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : undefined;
}

function str(v: unknown): string | undefined {
  if (v === undefined || v === null) return undefined;
  const s = String(v).trim();
  return s ? s.slice(0, 200) : undefined;
}
