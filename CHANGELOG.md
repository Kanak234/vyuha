# Changelog

## 4.1.0 — 2026-09-28

### Fixed
- **Java programs using the `Vyuha.java` helper did not compile.** Java's
  single-file launcher (`java File.java`) compiles only that file, so every call
  to `Vyuha.*` failed with "cannot find symbol" — the bundled `BinarySearch.java`
  example included. When `Vyuha.java` is beside the program, VYUHA now runs
  `javac -d <temp> File.java Vyuha.java && java -cp <temp> <Class>` (package
  declarations respected). Without the helper the old command is unchanged.
  Requires a JDK (`javac`).

### Added
- **C / C++ / Go helpers stamp the caller's source line**, so double-tap opens the
  right line in those languages too. C: `__LINE__` via call-site macros (calls that
  bypass the macro send no line, never a stale one). C++: `int line = __builtin_LINE()`
  default argument on every function (GCC, Clang, MSVC 19.26+; explicit value wins).
  Go: `runtime.Caller`, skipping frames inside `vyuha.go`. Source-compatible: no
  existing call needs to change.
- **Export GIF in the network view** (toolbar button). Records 40 frames at
  12.5 fps (~3.2 s) of the live animation, max 640 px wide, KP watermark on
  every frame; saved via the same dialog as run GIFs. Works for `.vyuha.json`
  specs and for networks printed by a program.

### Not in this release
- Debug Visualize for Java and JavaScript (needs `jdb` / the Node inspector).
- A helper called from a second C/C++ file reports that file's line number,
  which VYUHA opens in the run file.

### Verified
- `npm run verify`: all suites pass. New checks run the real toolchains: javac +
  java (bundled example), gcc `-Wall -Werror`, g++ `-Wall -Werror`, go run; and
  record a real 40-frame network GIF in the jsdom webview.


## 4.0.0 — 2026-09-28

Driven by tester feedback: "no bugs found, but give me a size control, and
highlight the line of code when I double-tap a sphere."

### Added
- **View dock** with **Zoom** and **Size** sliders (+ / − buttons, live readout),
  fixed on the left edge so it is visible at every panel width. Before this, zoom
  was wheel-only and the only sliders were hidden by the 820 px layout rule.
  Zoom is log-scaled and two-way synced with wheel / pinch / fit / reset.
  Size 0.4×–2.5× scales spheres, bars (base stays on the floor), halos, arrowheads
  and label offsets; layout spacing is untouched. Keys `+ - [ ] 0`.
- **Double-click / double-tap a node → open and highlight its source line.**
  Whole-line background, left bar and scrollbar mark; clears when you move the
  cursor or edit. Works in the run view and in `.vyuha.json` network specs.
- **Per-node source lines** (`VNode.line`). Filled automatically by
  auto-visualize (each function/loop/branch/print), Debug Visualize (each stack
  frame and its locals; gdb frames outside your file are ignored) and the
  Python, JavaScript and Java helpers (the call site in your main file).
- `vyuha.nodeSize` setting; theme colours `vyuha.sourceLineBackground` and
  `vyuha.sourceLineBorder` (override them in `workbench.colorCustomizations`).
- KP watermark: mark in the title panel and on every exported GIF frame.

### Changed
- **Data-structure view: a single click no longer moves the editor.** It opens the
  inspector (which now shows the node's line); double-click opens the code. The
  old jump stole the scroll position while you were only exploring.
- Invalid `line` values (0, negative, fractions, text) are dropped at the
  protocol boundary instead of being sent to the editor.

### Not in this release
- Go, C and C++ helpers do not report lines yet (use Debug Visualize for C/C++).
- A network emitted by a running program has no source anchors to open.

### Verified
- `npm run verify`: all six suites pass, including the new `tests/v4-test.js`
  (dock, sync, size, double-tap, watermark, protocol, auto-visualize, real
  python3 + gdb Debug Visualize, and real Python / Node / Java helper runs).


## 3.1.1

### Fixed

- **Debug Visualize traced nothing for C and C++.** The gdb command file is
  built from a TypeScript string array, and two lines ended with `"\n"` — a
  single backslash, which TypeScript turns into a real newline. That split the
  Python statement across two lines with an unterminated string, so the whole
  `python … end` block failed to parse and no trace markers were ever emitted.
  The parser then found nothing and the view stayed empty. C went from 0 frames
  to 645. The Python tracer used `\\n` and was never affected.

- **The trace descended into libc.** Those 645 frames were mostly glibc
  internals — line numbers in the thousands for a three-line program. Stops are
  now reported only for the file being traced, matched on the full basename.
  645 frames became 4, all of them in the user's own code.

- **A failed trace reported success.** Zero frames with a non-zero exit code
  still resolved `ok: true`, leaving the view empty with nothing to explain
  why. It now reports failure and points at
  `gdb --batch -ex "python print(1)"` to check gdb's Python support.

Verified with gdb 17.1: C traces 4 frames on the two executable lines of a
three-line file; Python is unchanged at 96 frames.


## [3.1.0] - 2026-09-02

### Added — Debugger-driven visualization (no print statements)
- **VYUHA: Debug Visualize** (`Ctrl+Alt+D`) — runs your program under a *real
  debugger* and turns the live call stack and local variables into frames. The
  program needs **zero `@vyuha` prints** — nothing to instrument.
  - **Python** — traced with your own `python3` via `sys.settrace`. No pip
    packages, works everywhere Python does.
  - **C / C++** — traced with **gdb** (`-g -O0`, stepped line by line). Requires
    `gdb` on PATH; if it is missing you get a clear message, never a crash.
- Each stop draws the call stack as a vertical tower — the top frame is active,
  callers sit below — with every local hanging beside its frame and updating as
  values change. Lists and arrays are drawn element by element, so you can watch
  them fill and sort in 3D.

### Added — Recursion call-trees
- New `@recursive` decorator in the Python helper. Decorate a recursive function
  and VYUHA draws its call tree as it runs: every call becomes a child node the
  moment it is entered, turns active while running, and settles to *done*
  carrying its return value as it unwinds. Works for linear, binary and mutual
  recursion. See the **recursion** example.

### Added — GIF export
- **Export GIF** button on the timeline (and **VYUHA: Export Run as GIF**) writes
  the entire run as a looping animated GIF. Encoded fully offline by a built-in
  GIF89a writer (median-cut palette + LZW) — no CDN, no dependency.

### Unchanged on purpose
- The native 3D renderer, the `@vyuha` frame protocol, the compiler visualizer,
  auto-visualization, terminal running, and the runner table are exactly as
  before. Every new feature feeds the same frame pipeline.

## [3.0.0] - 2026-09-01

### Added — Compiler Visualizer
- **VYUHA: Visualize Compilation** (`Ctrl+Alt+C`) — detects the compiler/interpreter
  actually installed on YOUR system (g++/gcc/clang, javac, python3, node, go — with
  fallbacks) and animates its real pipeline in the native 3D view:
  Source → Preprocess → Compile→ASM → Assemble → Link → Run for C/C++,
  Compile → Bytecode → JVM for Java, Parse → Bytecode → Interpreter for Python, etc.
- Every stage shows measured truth: tool name + version, stage timings,
  preprocessed line counts and headers pulled in, assembly instruction counts,
  the biggest emitted functions as 3D bars, object/binary sizes, exit codes.
- **VYUHA: Open Compiler Stage Artifact…** — open the real `.i` / `.s` files the
  compiler produced, straight from the last pipeline.
- Compile errors stop the pipeline at the failing stage and print the compiler's
  own first errors on that node.

### Added — Code Runner parity
- **Run Selected Code** — run just the highlighted snippet.
- **Run By Language…** — run the current file through any configured runner.
- Code Runner keybindings: `Ctrl+Alt+N` run, `Ctrl+Alt+M` stop
  (existing `Ctrl+Alt+V` / `Ctrl+Alt+X` still work).
- Compiler Visualizer added to the editor title Run menu and right-click menus.

### Unchanged on purpose
- The native 3D renderer, the @vyuha frame protocol, auto-visualization,
  terminal running, and the 50-language runner table are exactly as before —
  the new features feed the same frame pipeline instead of replacing anything.

## 2.1.0

**Every program draws something now.**

Until this release a program had to print `@vyuha` lines to be drawn at all.
Most programs do not, so a plain `hello world` produced an empty panel — which
looked like a bug even when nothing was broken.

- **Automatic visualisation.** VYUHA reads your source for its functions,
  classes, loops, branches, `return`s, input reads and printing statements, and
  works out which functions call which. That shape is joined to the toolchain —
  source, compile, link, run, output — in one graph. Stages light as the run
  moves through them, a compile error turns the compile stage red, and each line
  your program prints lights the statement it came from. Turn it off with
  `vyuha.autoVisualize`.
- The moment your program prints an `@vyuha` line it takes over, and VYUHA stops
  guessing.

**Programs run in the terminal.**

- Runs now happen in VS Code's integrated terminal, the way Code Runner does it.
  `cin >>`, `input()`, `Scanner` and `fmt.Scan` work, because there is a real
  terminal to type into, and prompts appear as they are written instead of in a
  lump at the end. On Unix the program is handed a pty, so its output is line
  buffered exactly as it would be if you ran it by hand.
- VYUHA reads a transcript of the same session, so frames are collected either
  way. Set `vyuha.runInTerminal` to `false` to run quietly in the background
  with output only in the VYUHA output channel.
- Stopping a run sends Ctrl+C to the terminal rather than leaving it running.

**New example.** `binary_tree.cpp` builds a tree from its preorder and inorder
traversals and walks it three ways, drawing a frame at every step.

## 2.0.0

- Renamed to VYUHA. File extension `.vyuha.json`, with `.netgraph.json` still
  accepted.
- **Run and Visualize** (Ctrl+Alt+V) for 52 file extensions, plus
  `vyuha.runners` for anything not in the table.
- Data structure rendering: array, linked list, stack, queue, matrix, tree and
  graph, with a playable, scrubbable timeline.
- Helper libraries for Python, JavaScript, Java, C++, C and Go.
- A program that reads input is fed `<name>.stdin`, `<name>.in` or `input.txt`
  if one sits beside the source, and no longer hangs when it does not.

## 1.0.0

- First release: 3D neural network inference graph from a `.netgraph.json`
  spec, with live rebuild on edit, cursor-to-camera sync and path tracing.
