#!/usr/bin/env python3
"""
Turn a PyTorch model into a .netgraph.json spec.

    python tools/export_torch_graph.py mymodel.py:build_model -o net.netgraph.json
    python tools/export_torch_graph.py checkpoint.pt -o net.netgraph.json

The first form imports a Python file and calls the named factory. The second
loads a saved module or state dict. Either way the walker reads the module tree,
maps each layer to a kind the renderer understands, and writes the spec.

Wide layers are capped: the renderer draws up to 256 units per layer, so a
4096-wide FFN is written as a representative 64. The spec is a picture of the
architecture, not a copy of the weights.
"""

import argparse
import importlib.util
import json
import re
import sys
from pathlib import Path

CAP = 64  # units drawn per layer

KIND_RULES = [
    (r"embedding",                         "dense"),
    (r"multiheadattention|attention|attn", "attn"),
    (r"layernorm|batchnorm|rmsnorm|norm",  "norm"),
    (r"relu|gelu|silu|tanh|sigmoid",       "relu"),
    (r"linear|conv\d?d|lazylinear",        "ffn"),
]


def kind_for(module) -> str:
    name = type(module).__name__.lower()
    for pattern, kind in KIND_RULES:
        if re.search(pattern, name):
            return kind
    return "dense"


def width_for(module) -> int:
    for attr in ("out_features", "out_channels", "embedding_dim", "normalized_shape",
                 "num_features", "hidden_size", "embed_dim"):
        v = getattr(module, attr, None)
        if isinstance(v, int) and v > 0:
            return v
        if isinstance(v, (list, tuple)) and v and isinstance(v[0], int):
            return v[0]
    return 0


def in_width(module) -> int:
    for attr in ("in_features", "in_channels", "num_embeddings", "embed_dim"):
        v = getattr(module, attr, None)
        if isinstance(v, int) and v > 0:
            return v
    return 0


def slug(text: str) -> str:
    s = re.sub(r"[^a-z0-9]+", "_", text.lower()).strip("_")
    return s or "layer"


def walk(model):
    """Leaf modules in definition order, with the width each one produces."""
    leaves = []
    for name, mod in model.named_modules():
        if not name:
            continue
        if len(list(mod.children())) > 0:
            continue
        w = width_for(mod)
        if w == 0:
            continue
        leaves.append((name, mod, w))
    return leaves


def build_spec(model, name: str) -> dict:
    leaves = walk(model)
    if not leaves:
        raise SystemExit("No sized layers found. This walker reads Linear, Conv, "
                         "Embedding, Norm and Attention modules.")

    layers = []
    first_in = in_width(leaves[0][1]) or leaves[0][2]
    layers.append({
        "id": "input",
        "name": "Input",
        "kind": "input",
        "n": min(first_in, 16),
    })

    used = set(["input"])
    for path, mod, w in leaves:
        base = slug(path)
        lid, i = base, 2
        while lid in used:
            lid, i = base + "_" + str(i), i + 1
        used.add(lid)
        layers.append({
            "id": lid,
            "name": path.replace(".", " · "),
            "kind": kind_for(mod),
            "n": min(w, CAP),
            "trueWidth": w,
        })

    layers[-1]["kind"] = "output"
    layers[-1]["name"] = "Output"
    if layers[-1]["n"] <= 16:
        layers[-1]["labels"] = ["out " + str(i) for i in range(layers[-1]["n"])]

    return {
        "meta": {
            "name": name,
            "note": str(len(layers)) + " layers walked from the module tree",
        },
        "seed": 20260826,
        "layers": layers,
    }


def load_from_factory(spec_arg: str):
    path_str, _, func = spec_arg.partition(":")
    path = Path(path_str)
    if not path.exists():
        raise SystemExit("No file at " + str(path))
    mod_spec = importlib.util.spec_from_file_location("usermodel", path)
    if mod_spec is None or mod_spec.loader is None:
        raise SystemExit("Could not import " + str(path))
    module = importlib.util.module_from_spec(mod_spec)
    mod_spec.loader.exec_module(module)
    factory = getattr(module, func or "build_model", None)
    if factory is None:
        raise SystemExit("No callable named '" + (func or "build_model") + "' in " + str(path))
    return factory()


def load_checkpoint(path_str: str):
    import torch
    obj = torch.load(path_str, map_location="cpu", weights_only=False)
    if hasattr(obj, "named_modules"):
        return obj
    raise SystemExit("That checkpoint holds a state dict, not a module. Point this "
                     "script at the file that builds the model instead, as "
                     "mymodel.py:build_model")


def main() -> None:
    ap = argparse.ArgumentParser(description="Export a PyTorch model as a graph spec.")
    ap.add_argument("model", help="module.py:factory, or a saved .pt module")
    ap.add_argument("-o", "--out", default="model.netgraph.json", help="where to write the spec")
    ap.add_argument("--name", default="", help="name shown in the graph header")
    args = ap.parse_args()

    if ":" in args.model or args.model.endswith(".py"):
        model = load_from_factory(args.model)
    else:
        model = load_checkpoint(args.model)

    model.eval()
    spec = build_spec(model, args.name or Path(args.model).stem)

    out = Path(args.out)
    out.write_text(json.dumps(spec, indent=2) + "\n", encoding="utf-8")
    total = sum(l["n"] for l in spec["layers"])
    print("Wrote " + str(out) + " — " + str(len(spec["layers"])) + " layers, " + str(total) + " units drawn.")
    print("Open it in VS Code to see the graph.")


if __name__ == "__main__":
    sys.exit(main())
