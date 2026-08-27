"""
VYUHA — draw your data structures from Python.

The whole protocol is one printed line, so this module is a convenience,
not a requirement:

    print('@vyuha ' + json.dumps({"array": [3, 1, 2], "active": [0]}))

Usage:

    from vyuha import array, linked_list, tree, graph, matrix, stack, queue, frame

    for i in range(len(a)):
        array(a, active=[i], title="selection sort", note=f"pass {i}")
"""

import json as _json
import sys as _sys

__all__ = [
    "array", "matrix", "linked_list", "stack", "queue",
    "tree", "graph", "frame", "emit"
]


def emit(payload):
    """Write one frame. Everything else here funnels through this."""
    _sys.stdout.write("@vyuha " + _json.dumps(payload, default=str) + "\n")
    _sys.stdout.flush()


def _meta(payload, title, note, active, done, line):
    if title is not None:
        payload["title"] = title
    if note is not None:
        payload["note"] = note
    if active is not None:
        payload["active"] = list(active)
    if done is not None:
        payload["done"] = list(done)
    if line is not None:
        payload["line"] = line
    return payload


def array(values, active=None, done=None, title=None, note=None, line=None):
    """A row of bars. Heights follow the values, so sorting is visible."""
    emit(_meta({"kind": "array", "array": list(values)}, title, note, active, done, line))


def matrix(rows, active=None, done=None, title=None, note=None, line=None):
    """A 2D grid. `active` entries are "row,col" strings."""
    emit(_meta({"kind": "matrix", "matrix": [list(r) for r in rows]}, title, note, active, done, line))


def stack(values, active=None, title=None, note=None, line=None):
    emit(_meta({"kind": "stack", "stack": list(values)}, title, note, active, None, line))


def queue(values, active=None, title=None, note=None, line=None):
    emit(_meta({"kind": "queue", "queue": list(values)}, title, note, active, None, line))


def linked_list(values, active=None, title=None, note=None, line=None):
    """Pass a list of values, or a head node with .value/.val and .next."""
    emit(_meta({"kind": "list", "list": _chain(values)}, title, note, active, None, line))


def _chain(head):
    if isinstance(head, (list, tuple)):
        return list(head)
    out, seen, node = [], set(), head
    while node is not None and id(node) not in seen:
        seen.add(id(node))
        out.append(_value_of(node))
        node = getattr(node, "next", None) or getattr(node, "nxt", None)
    return out


def _value_of(node):
    for name in ("value", "val", "data", "key"):
        if hasattr(node, name):
            return getattr(node, name)
    return str(node)


def tree(root, active=None, title=None, note=None, line=None):
    """
    Pass a nested dict, or any object with .left/.right or .children.
    Node values are read from .value, .val, .data or .key.
    """
    emit(_meta({"kind": "tree", "tree": _tree_of(root)}, title, note, active, None, line))


def _tree_of(node):
    if node is None:
        return None
    if isinstance(node, dict):
        return node
    out = {"value": _value_of(node)}
    if hasattr(node, "state"):
        out["state"] = getattr(node, "state")
    kids = getattr(node, "children", None)
    if kids is not None:
        out["children"] = [_tree_of(k) for k in kids if k is not None]
    else:
        left = _tree_of(getattr(node, "left", None))
        right = _tree_of(getattr(node, "right", None))
        if left is not None:
            out["left"] = left
        if right is not None:
            out["right"] = right
    return out


def graph(adjacency, active=None, visited=None, directed=True,
          title=None, note=None, line=None):
    """
    adjacency maps a node to its neighbours:
        {"a": ["b", "c"], "b": [("c", 4)]}
    A (neighbour, weight) pair draws a weighted edge.
    """
    adj = {}
    for k, v in adjacency.items():
        adj[str(k)] = [list(x) if isinstance(x, (list, tuple)) else str(x) for x in v]
    payload = {"kind": "graph", "adjacency": adj, "directed": bool(directed)}
    if visited is not None:
        payload["visited"] = list(visited)
    emit(_meta(payload, title, note, active, None, line))


def frame(nodes, edges=None, kind="graph", title=None, note=None, line=None):
    """Full control: give the nodes and edges yourself."""
    payload = {"kind": kind, "nodes": nodes, "edges": edges or []}
    emit(_meta(payload, title, note, None, None, line))
