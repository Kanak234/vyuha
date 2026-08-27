/**
 * VYUHA — draw your data structures from Node.
 *
 * The protocol is one printed line, so this file is a convenience:
 *
 *     console.log('@vyuha ' + JSON.stringify({ array: [3,1,2], active: [0] }));
 *
 * Usage:
 *     const v = require('./vyuha');
 *     v.array(a, { active: [i], title: 'bubble sort', note: `pass ${p}` });
 */

'use strict';

function emit(payload) {
  process.stdout.write('@vyuha ' + JSON.stringify(payload) + '\n');
}

function meta(payload, o) {
  o = o || {};
  if (o.title !== undefined) payload.title = o.title;
  if (o.note !== undefined) payload.note = o.note;
  if (o.active !== undefined) payload.active = [].concat(o.active);
  if (o.done !== undefined) payload.done = [].concat(o.done);
  if (o.line !== undefined) payload.line = o.line;
  return payload;
}

/** A row of bars; heights follow the values, so sorting is visible. */
function array(values, o) {
  emit(meta({ kind: 'array', array: Array.from(values) }, o));
}

/** A 2D grid. `active` entries are "row,col" strings. */
function matrix(rows, o) {
  emit(meta({ kind: 'matrix', matrix: rows.map(r => Array.from(r)) }, o));
}

function stack(values, o) { emit(meta({ kind: 'stack', stack: Array.from(values) }, o)); }
function queue(values, o) { emit(meta({ kind: 'queue', queue: Array.from(values) }, o)); }

/** Pass an array of values, or a head node with .value/.val and .next. */
function linkedList(head, o) {
  emit(meta({ kind: 'list', list: chain(head) }, o));
}

function chain(head) {
  if (Array.isArray(head)) return head.slice();
  const out = [];
  const seen = new Set();
  let node = head;
  while (node && !seen.has(node)) {
    seen.add(node);
    out.push(valueOf(node));
    node = node.next || node.nxt || null;
  }
  return out;
}

function valueOf(node) {
  if (node === null || typeof node !== 'object') return node;
  for (const k of ['value', 'val', 'data', 'key']) {
    if (node[k] !== undefined) return node[k];
  }
  return String(node);
}

/** Pass a nested object with .left/.right or .children. */
function tree(root, o) {
  emit(meta({ kind: 'tree', tree: treeOf(root) }, o));
}

function treeOf(node) {
  if (node === null || node === undefined) return null;
  if (typeof node !== 'object') return { value: node };
  const out = { value: valueOf(node) };
  if (node.state) out.state = node.state;
  if (Array.isArray(node.children)) {
    out.children = node.children.filter(Boolean).map(treeOf);
  } else {
    const l = treeOf(node.left), r = treeOf(node.right);
    if (l) out.left = l;
    if (r) out.right = r;
  }
  return out;
}

/**
 * adjacency maps a node to its neighbours:
 *     { a: ['b', 'c'], b: [['c', 4]] }
 * A [neighbour, weight] pair draws a weighted edge.
 */
function graph(adjacency, o) {
  o = o || {};
  const payload = { kind: 'graph', adjacency: adjacency, directed: o.directed !== false };
  if (o.visited !== undefined) payload.visited = [].concat(o.visited);
  emit(meta(payload, o));
}

/** Full control: give the nodes and edges yourself. */
function frame(nodes, edges, o) {
  o = o || {};
  emit(meta({ kind: o.kind || 'graph', nodes: nodes, edges: edges || [] }, o));
}

module.exports = { emit, array, matrix, stack, queue, linkedList, tree, graph, frame };
