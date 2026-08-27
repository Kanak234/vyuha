/**
 * The graph spec: the one contract between the file on disk, the extension,
 * and the renderer. Everything else is derived from it.
 */

export type LayerKind = 'input' | 'dense' | 'attn' | 'norm' | 'ffn' | 'relu' | 'output';

export const LAYER_KINDS: LayerKind[] = ['input', 'dense', 'attn', 'norm', 'ffn', 'relu', 'output'];

export interface LayerSpec {
  id: string;
  name: string;
  kind: LayerKind;
  n: number;
  labels?: string[];
  residualFrom?: string;
}

export interface GraphSpec {
  meta?: { name?: string; note?: string };
  seed?: number;
  layers: LayerSpec[];
}

/** A layer plus where it lives in the source file. */
export interface LayerAnchor {
  index: number;
  id: string;
  name: string;
  kind: LayerKind;
  n: number;
  line: number;      // zero-based line of this layer's `"id"` property
  endLine: number;   // last line this layer owns, for cursor mapping
}

export interface ParseOk {
  ok: true;
  spec: GraphSpec;
  anchors: LayerAnchor[];
  unitCount: number;
}
export interface ParseFail {
  ok: false;
  message: string;
  line?: number;
}
export type ParseResult = ParseOk | ParseFail;

/**
 * Parses and validates a spec. Errors name the layer and say what to fix,
 * because the file is hand-edited as often as it is generated.
 */
export function parseSpec(text: string): ParseResult {
  let raw: unknown;
  try {
    raw = JSON.parse(stripComments(text));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, message: 'This file is not valid JSON. ' + msg, line: lineFromJsonError(text, msg) };
  }

  if (!raw || typeof raw !== 'object') {
    return { ok: false, message: 'The spec must be a JSON object with a `layers` array.' };
  }
  const obj = raw as Record<string, unknown>;
  const layers = obj.layers;
  if (!Array.isArray(layers) || layers.length === 0) {
    return { ok: false, message: 'The spec needs a `layers` array with at least one layer.' };
  }
  if (layers.length > 64) {
    return { ok: false, message: 'This spec has ' + layers.length + ' layers. The renderer draws up to 64.' };
  }

  const seen = new Set<string>();
  const clean: LayerSpec[] = [];

  for (let i = 0; i < layers.length; i++) {
    const l = layers[i] as Record<string, unknown>;
    const where = 'Layer ' + (i + 1);
    if (!l || typeof l !== 'object') return { ok: false, message: where + ' is not an object.' };

    const id = typeof l.id === 'string' && l.id.trim() ? l.id.trim() : '';
    if (!id) return { ok: false, message: where + ' needs a non-empty `id`.' };
    if (seen.has(id)) return { ok: false, message: 'Two layers share the id "' + id + '". Ids must be unique.' };
    seen.add(id);

    const kind = l.kind as LayerKind;
    if (LAYER_KINDS.indexOf(kind) < 0) {
      return { ok: false, message: 'Layer "' + id + '" has kind "' + String(l.kind) + '". Use one of: ' + LAYER_KINDS.join(', ') + '.' };
    }

    const n = Number(l.n);
    if (!Number.isFinite(n) || n < 1) return { ok: false, message: 'Layer "' + id + '" needs `n` — how many units it holds.' };
    if (n > 256) return { ok: false, message: 'Layer "' + id + '" declares ' + n + ' units. The renderer draws up to 256 per layer.' };

    const labels = Array.isArray(l.labels) ? (l.labels as unknown[]).map(String) : undefined;
    if (labels && labels.length !== Math.floor(n)) {
      return { ok: false, message: 'Layer "' + id + '" has ' + labels.length + ' labels for ' + n + ' units. They must match.' };
    }

    clean.push({
      id,
      name: typeof l.name === 'string' && l.name.trim() ? l.name.trim() : id,
      kind,
      n: Math.floor(n),
      labels,
      residualFrom: typeof l.residualFrom === 'string' ? l.residualFrom : undefined
    });
  }

  for (const l of clean) {
    if (l.residualFrom && !seen.has(l.residualFrom)) {
      return { ok: false, message: 'Layer "' + l.id + '" takes a residual from "' + l.residualFrom + '", which no layer declares.' };
    }
  }

  const spec: GraphSpec = {
    meta: (obj.meta as GraphSpec['meta']) || { name: 'network' },
    seed: Number.isFinite(Number(obj.seed)) ? Number(obj.seed) : 1,
    layers: clean
  };

  return { ok: true, spec, anchors: anchorLayers(text, clean), unitCount: clean.reduce((s, l) => s + l.n, 0) };
}

/**
 * Finds the line each layer is declared on by scanning for its id, then gives
 * each layer the span up to the next one. Text scanning keeps this dependency
 * free and survives comments and odd formatting.
 */
export function anchorLayers(text: string, layers: LayerSpec[]): LayerAnchor[] {
  const lines = text.split(/\r?\n/);
  const anchors: LayerAnchor[] = [];
  let cursor = 0;

  layers.forEach((l, index) => {
    const needle = new RegExp('"id"\\s*:\\s*"' + escapeRe(l.id) + '"');
    let line = -1;
    for (let i = cursor; i < lines.length; i++) {
      if (needle.test(lines[i])) { line = i; break; }
    }
    if (line < 0) {
      for (let i = 0; i < lines.length; i++) {
        if (needle.test(lines[i])) { line = i; break; }
      }
    }
    if (line >= 0) cursor = line + 1;
    anchors.push({
      index, id: l.id, name: l.name, kind: l.kind, n: l.n,
      line: line < 0 ? 0 : line,
      endLine: line < 0 ? 0 : line
    });
  });

  for (let i = 0; i < anchors.length; i++) {
    anchors[i].endLine = i + 1 < anchors.length ? Math.max(anchors[i].line, anchors[i + 1].line - 1) : lines.length - 1;
  }
  return anchors;
}

/** Which layer owns a given line — used to follow the editor cursor. */
export function layerAtLine(anchors: LayerAnchor[], line: number): number {
  for (let i = 0; i < anchors.length; i++) {
    if (line >= anchors[i].line && line <= anchors[i].endLine) return i;
  }
  return -1;
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Tolerates // and /* *\/ comments so .netgraph files can carry notes. */
function stripComments(text: string): string {
  let out = '';
  let inStr = false, esc = false, inLine = false, inBlock = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i], d = text[i + 1];
    if (inLine) { if (c === '\n') { inLine = false; out += c; } continue; }
    if (inBlock) { if (c === '*' && d === '/') { inBlock = false; i++; } continue; }
    if (inStr) {
      out += c;
      if (esc) esc = false;
      else if (c === '\\') esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') { inStr = true; out += c; continue; }
    if (c === '/' && d === '/') { inLine = true; i++; continue; }
    if (c === '/' && d === '*') { inBlock = true; i++; continue; }
    out += c;
  }
  return out;
}

function lineFromJsonError(text: string, msg: string): number | undefined {
  const m = /position\s+(\d+)/i.exec(msg);
  if (!m) return undefined;
  const pos = Number(m[1]);
  return text.slice(0, pos).split(/\r?\n/).length - 1;
}

/** The template dropped by "New graph spec file". */
export function templateSpec(): string {
  return JSON.stringify({
    meta: { name: 'policy-net', note: '3 encoder blocks, 6-action policy head' },
    seed: 20260826,
    layers: [
      { id: 'tok', name: 'Token input', kind: 'input', n: 8 },
      { id: 'emb', name: 'Embedding', kind: 'dense', n: 14 },
      { id: 'a1', name: 'Attention · 01', kind: 'attn', n: 12 },
      { id: 'n1', name: 'Add & norm', kind: 'norm', n: 8, residualFrom: 'emb' },
      { id: 'f1', name: 'Feed forward · 01', kind: 'ffn', n: 16 },
      { id: 'a2', name: 'Attention · 02', kind: 'attn', n: 12 },
      { id: 'n2', name: 'Add & norm', kind: 'norm', n: 8, residualFrom: 'f1' },
      { id: 'f2', name: 'Feed forward · 02', kind: 'ffn', n: 16 },
      { id: 'h1', name: 'Hidden · relu', kind: 'relu', n: 20 },
      {
        id: 'out', name: 'Policy head', kind: 'output', n: 6,
        labels: ['Go to food', 'Eat', 'Hide', 'Flee', 'Idle', 'Sleep']
      }
    ]
  }, null, 2) + '\n';
}
