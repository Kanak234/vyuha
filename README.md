# VYUHA

<img src="media/logo-mark.png" alt="KP" width="48" align="right">

**व्यूह** — an arranged formation. Run your code in any language and watch the structure it builds, in 3D, inside VS Code.

![runs on any language](https://img.shields.io/badge/languages-50%2B-38e8ff) ![no telemetry](https://img.shields.io/badge/telemetry-none-35f0a8)

---

## The whole idea

Your program draws itself by printing one line:

```
@vyuha {"kind":"array","array":[5,3,8],"active":[1]}
```

That is the entire protocol. Any language that can print to stdout is supported — no binding required, no library to install, nothing to link. Each printed line becomes one frame on a timeline you can play, scrub and step through.

```python
from vyuha import array

for i in range(len(a) - 1):
    array(a, active=[i, i + 1], note=f"compare {a[i]} and {a[i+1]}")
```

Press **Ctrl+Alt+V** and the sort plays back in front of you.

---

## New in 4.0.0 — size control and "double-tap to see the code"

Both came straight from a tester's feedback.

**View dock (left edge, every panel width).** A **Zoom** slider and a **Size** slider, each with `+` / `−` buttons and a live readout. Zoom stays in sync with the mouse wheel and pinch. Size runs from 0.4× to 2.5× and grows spheres, bars, halos and arrowheads without moving anything. Keys: `+` `-` zoom, `]` `[` size, `0` back to 1.0×.

**Double-click (or double-tap) any node** and the editor jumps to the line that produced it, centres it and highlights the whole line. A single click still just opens the inspector, which now shows the node's line.

Lines come for free — nothing to add to your code:

| where the picture comes from | line opened |
|---|---|
| any program (auto-visualize) | the function / loop / branch / print that node stands for |
| **Debug Visualize** (Python, C/C++, Java) | that call frame's current line — also for its local variables |
| `vyuha.py`, `vyuha.js`, `Vyuha.java` helpers | the line in your script that called the helper |
| `vyuha.h` (C), `vyuha.hpp` (C++), `vyuha.go` helpers | same — since 4.1.0 (C via `__LINE__` macros, C++ via `__builtin_LINE()`, Go via `runtime.Caller`) |
| raw `@vyuha` JSON | `"line"` on the frame, or on any single node |

---

### 4.1.2

- **Debug Visualize for Java.** No print calls needed: VYUHA compiles with `javac -g`, runs the program under the JDWP agent and drives `jdb` step by step — call stack, the top frame's locals and arrays, every line. Needs a JDK. Helper code (`Vyuha.java`) is stepped over.
- **Clearer "WebGL didn't start" help:** on Linux the snap build of VS Code often has no GPU access; the message now says to use the `.deb` / `.rpm`.

### 4.1.0

- **Java + helper fixed.** `java File.java` compiles only one file, so any program using `Vyuha.java` (including the bundled `BinarySearch.java`) failed with *cannot find symbol*. VYUHA now compiles both with `javac` into a temp folder when the helper sits beside your file. Needs a JDK (`javac`), not just a JRE.
- **C, C++ and Go helpers report source lines**, so double-tap works there too.
- **Export GIF in the network view** — records ~3 seconds of the live animation (40 frames, KP watermark).

## What it draws

| kind | shows |
|---|---|
| `array` | a row of bars whose heights follow the values — sorting is visible at a glance |
| `list` | a linked list with arrows between cells |
| `stack` | a vertical column, first element at the bottom |
| `queue` | a horizontal run, front on the left |
| `matrix` | a 2D grid |
| `tree` | laid out by depth, parents centred over their children |
| `graph` | a force-directed layout with weighted, directed edges |

Node colours carry meaning: blue is untouched, amber is being looked at, violet has been seen, green has settled, red is a problem.

It also renders **neural networks**. Open a `.vyuha.json` spec and a signal crosses every layer, locks a decision, and traces the path that produced it.

---

## Every program draws something

A program does not have to know about VYUHA to be drawn. Print `hello world` in
C++ and you still get a picture: VYUHA reads your source for its functions,
loops, branches and printing statements, joins that shape to the toolchain
stages, and animates the run across the whole thing.

```
source ──▶ compile ──▶ link ──▶ run ──▶ output
                                 │
                                 └──▶ main()  ──▶ for · 12  ──▶ print · 14
```

Stages light as the run passes through them. A compile error turns the compile
stage red. Each line your program prints lights the statement it came from, so
you watch execution move through your own code.

The moment your program prints an `@vyuha` line, it takes over — VYUHA stops
guessing and draws what you asked for. Turn the read off with
`vyuha.autoVisualize` if you only ever want your own frames.

---

## It runs in the terminal

Programs run in VS Code's integrated terminal, the way Code Runner runs them.
That matters for anything that reads input: `cin >>`, `input()`, `Scanner`,
`fmt.Scan` all work, because there is a real terminal to type into. Prompts
appear as they are written rather than in a lump at the end.

VYUHA reads a transcript of that same session to build the picture, so nothing
is lost either way. If you would rather run quietly with output only in the
VYUHA output channel, set `vyuha.runInTerminal` to `false`.

For input you do not want to type every time, put it in a file next to your
source — `program.stdin`, `program.in` or `input.txt` — and it is fed in
automatically.

---

## Getting started

1. Open any source file.
2. **Ctrl+Alt+V**, or the ▷ button in the editor title bar, or right-click → *Run and Visualize*.
3. Watch the panel.

Run **VYUHA: Add Helper Library** to drop a ready-made helper into your project
— Python, JavaScript, Java, C++, C, or Go — or **VYUHA: Open an Example** to see
a working one. `binary_tree.cpp` is a good place to start: it builds a tree from
its preorder and inorder traversals and walks it three ways, one frame per step.

---

## Use in the browser (vscode.dev)

VYUHA runs on [vscode.dev](https://vscode.dev) and in **GitHub Codespaces** — no install needed. Open a `.vyuha.json` or `.netgraph.json` file and visualize immediately.

| Works on web ✅ | Desktop only ❌ |
|---|---|
| Graph spec editor (`.vyuha.json`, `.netgraph.json`) | Run and Visualize (any language) |
| Neural network visualization (inference, trace path) | Stop Run / Re-run |
| Data structure visualization (from loaded traces) | Visualize Compilation (real toolchain) |
| Timeline playback (play/pause/step/goto frame) | Debug Visualize (gdb/jdb/Python tracer) |
| Layer tree view, double-tap → reveal source line | Run Selection / Run By Language |
| Export trace as JSON, export animation as GIF | Open Compiler Stage Artifact |
| Fetch live trace from HTTP endpoint | Terminal integration |
| Add helper library (Python, JS, Java, C++, C, Go) | Auto-visualization of plain programs |
| Open bundled examples | |
| All `vyuha.*` settings | |

> **On the web:** Program execution needs desktop VS Code (it runs real compilers). Visualization works here. If you trigger a desktop-only command, you'll see: *"This feature needs VS Code Desktop (it runs real compilers). Visualization works here."*

---

## Languages

Fifty-odd extensions are mapped out of the box: Python, JavaScript, TypeScript, Java, Kotlin, C, C++, Objective-C, Go, Rust, Ruby, PHP, Perl, Lua, shell, PowerShell, R, Julia, Swift, Dart, Scala, Groovy, Clojure, Haskell, Elixir, Erlang, Nim, Zig, Crystal, D, V, Fortran, C#, F#, CoffeeScript, Tcl, awk and more.

Anything missing is one setting away:

```json
"vyuha.runners": {
  "kt": "kotlin \"${file}\"",
  "py": "conda run -n ml python -u \"${file}\""
}
```

Placeholders: `${file}`, `${dir}`, `${fileBasename}`, `${fileBasenameNoExt}`, `${bin}`.

---

## Accepted payloads

All of these are valid — use whichever is least work in your language.

```jsonc
[5, 3, 8]                                        // bare array
{"array": [5,3,8], "active": [1], "done": [2]}
{"matrix": [[1,2],[3,4]], "active": ["0,1"]}
{"list": [1,2,3]}   {"stack": [1,2]}   {"queue": [1,2]}
{"tree": {"value": 5, "left": {"value": 3}, "right": {"value": 8}}}
{"tree": {"value": 1, "children": [{"value": 2}]}}
{"adjacency": {"a": ["b"], "b": [["c", 4]]}}     // [neighbour, weight]
{"nodes": [{"id":"x","label":"X","state":"active"}], "edges": [{"from":"x","to":"y"}]}
{"layers": [...]}                                // a neural network spec
```

Every payload also accepts `title`, `note`, and `line` (a 1-based source line — double-clicking a node opens and highlights it). Since 4.0.0 any node inside `nodes` or `tree` can carry its own `line` too, which wins over the frame's.

Prefixes `@vyuha`, `#vyuha`, `##vyuha` and `//vyuha` all work, so the marker can live inside a comment in languages where that reads better.

---

## Commands

| command | default key |
|---|---|
| VYUHA: Run and Visualize | `Ctrl+Alt+V` |
| VYUHA: Stop Running Program | `Ctrl+Alt+X` |
| VYUHA: Re-run Last Program | |
| VYUHA: Play / Pause Timeline | `Space` in the panel |
| VYUHA: Next / Previous Frame | `←` `→` in the panel |
| VYUHA: Add Helper Library | |
| VYUHA: Open an Example | |
| VYUHA: Show Program Output | |
| VYUHA: New Network Spec File | |

---

## Settings

| setting | default | what it does |
|---|---|---|
| `vyuha.runners` | `{}` | add or override a run command per extension |
| `vyuha.runCwd` | `file` | run in the file's folder, or the workspace root |
| `vyuha.runTimeout` | `120` | seconds before a runaway program is killed |
| `vyuha.maxFrames` | `2000` | cap on captured frames |
| `vyuha.autoPlay` | `true` | start the timeline when the program ends |
| `vyuha.frameDelay` | `420` | milliseconds each frame is held |
| `vyuha.glow` | `true` | bloom pass — turn off on a weak GPU |
| `vyuha.labels` | `true` | floating labels |
| `vyuha.nodeSize` | `1` | starting node size (0.4–2.5); the Size slider changes it live |
| `vyuha.revealOnClick` | `true` | network specs: single-click also moves the cursor to the layer |
| `vyuha.traceEndpoint` | `""` | HTTP endpoint serving live neural activations |

---

## Building it yourself

```bash
./install.sh          # macOS / Linux
.\install.ps1         # Windows
```

That installs dependencies, vendors three.js, compiles, runs three test suites, packages a `.vsix`, and installs it. Or step by step:

```bash
npm install
npm run verify        # vendor + compile + test
npx @vscode/vsce package
code --install-extension vyuha-2.0.0.vsix --force
```

---

## Privacy

VYUHA sends nothing anywhere. Your program runs on your machine, its output is parsed locally, and three.js is bundled rather than fetched — the webview has no network access at all under its content security policy.

## Licence

MIT © 2026 Kanak Prabhakar

## Compiler Visualizer (v3.0)

VYUHA now shows you the **real toolchain on your machine**. Press `Ctrl+Alt+C` on a
C, C++, Java, Python, JavaScript, TypeScript or Go file and VYUHA finds whichever
compiler or interpreter you actually have installed (g++, clang, javac, python3,
node, go…), prints its version, and animates its genuine stages in 3D — with the
measured facts on every node: how many lines the preprocessor produced, how many
assembly instructions the compiler emitted, which of your functions got the most,
how big the object file and binary are, and how long each stage took. The `.i`
and `.s` artifacts it opens are the compiler's real output, not a simulation.

---

## Credits

Built by **Kanak Prabhakar** ([Cooding with Kanak](https://kanakprabhakar.online)). The KP mark appears in the view's title panel and in the corner of every exported GIF.

---

## Troubleshooting

**"WebGL didn't start" on Linux.** Check `snap list code`. If VS Code is the snap build, remove it (`sudo snap remove code`) and install the `.deb` from code.visualstudio.com — settings and extensions stay in `~/.config/Code` and `~/.vscode`. Otherwise try `code --ignore-gpu-blocklist`, and make sure hardware acceleration is not disabled in `~/.vscode/argv.json`.
