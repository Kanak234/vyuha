# Changelog

## 4.2.0 — 2026-10-13 · stable

A stability release: a new 158-check test (`tests/stability-test.js`) went over
every part of VYUHA and found 15 real bugs. All are fixed.

### Fixed — @vyuha frames
- `null`, `""`, `true` / `false` in an array became bars of height 0 or 1.
  They now have no height, like text values.
- A very deep tree (10,000+ levels) crashed the run with "Maximum call stack size
  exceeded". Trees are now walked without recursion.
- Two nodes with the same id were both drawn, and edges joined the wrong one.
  The first one is kept.
- Long emoji / Hindi labels were cut in the middle of a character.
- Tree children given as plain values (`"children": [1, 2]`) are now labelled
  with their values.

### Fixed — terminal runs
- Window-title and VS Code shell-integration codes (OSC sequences) were left in
  the transcript, so a `@vyuha` line after them was not drawn.

### Fixed — helper libraries
- **C++ (`vyuha.hpp`)**: control characters in titles were written as `\u001`
  (invalid JSON). `vector<string>` and `vector<char>` were written without
  quotes, and `NaN` / `inf` doubles as `nan` / `inf`. Each of these made the
  whole frame invalid JSON. `tree(nullptr)` was rejected. All of these now
  produce valid frames.
- **Python (`vyuha.py`)**: `float('nan')` / `inf` produced `NaN`, which is not
  JSON, so the frame was dropped. They are now `null`. A tree whose nodes point
  back to each other no longer recurses forever.
- **JavaScript (`vyuha.js`)**: a cyclic tree crashed the user's program, and so
  did a `BigInt` value. Both are handled now.

### Fixed — source picture and net specs
- Loops and prints inside `/* block comments */` and Python `"""docstrings"""`
  were drawn as real code. Python `a // b` (integer division) was treated as a
  comment, which cut the line off.
- A broken `.vyuha.json` spec showed no error line on Node 20+.
- A spec whose `meta` was not an object now loads.

### Tests
- `tests/stability-test.js` (158 checks) is part of `npm test`, so it runs in CI
  on Windows, Linux and macOS. It covers the protocol, the terminal transcript
  reader, real shell runs, the background runner, run commands for 50+
  languages, crash codes, stdin files, the source graph, net specs, and the
  Python / JS / C / C++ / Java / Go helpers compiled and run for real.

## 4.1.5 — 2026-10-13

### Fixed — Windows (Rahul ke laptop par C++ crash, exit code -1073740791)

- **C/C++ programs crashed on some PCs with `-1073740791` (0xC0000409).** A MinGW
  `.exe` loads `libstdc++-6.dll` / `libgcc` from PATH at run time; when another
  MinGW (Code::Blocks, Git, Anaconda…) sits earlier on PATH, the wrong DLL is
  loaded and the program crashes for no fault of its own. On Windows VYUHA now
  builds with `g++ -static` / `gcc -static`, so the runtime lives inside the
  `.exe` and PATH no longer matters.
- **Crash codes are explained.** Instead of a bare `-1073740791`, the output now
  says e.g. `0xC0000409 STACK_BUFFER_OVERRUN / FAST_FAIL — an array written past
  its end, an uncaught exception, or abort()`. Also covers access violation,
  stack overflow (deep recursion), divide by zero, heap corruption and DLL errors.
- **Pressing Run while the previous program was still running** (e.g. waiting
  on `cin`) typed the new command into that program's input — the two runs'
  lines got mixed in the terminal log. The running program's terminal is now
  closed first and the new run gets a fresh terminal.

### Tests

- `tests/interpreters-test.js`: crash-code text, `-static` on Windows g++, a real
  C++ compile + run, and a real crashing program.
- `tests/extension-test.js`: a second Run while the first is in progress closes
  the old terminal and uses a new one (fails on 4.1.4, passes now).

## 4.1.4 — 2026-10-12

### Fixed

- **macOS: the first line of program output was corrupted in the terminal run.**
  macOS's `script` writes an EOF echo (`^D` plus two backspaces) in front of the
  program's first output line, so a first `@vyuha` frame no longer parsed and was
  dropped. The log reader now removes that echo and applies backspaces like a
  terminal does.

- **Windows: Java Debug Visualize traced nothing** ("jdb produced no steps").
  VYUHA waited for the JVM to print "Listening for transport … at address: PORT"
  before attaching jdb; on Windows that line sits in a pipe buffer and never
  arrives, so the JVM stayed suspended forever. The debug port is now chosen up
  front, jdb attaches after a short wait (retrying while the JVM starts), and
  jdb's `\r\n` output is normalised. Root cause found from a jdb transcript in
  CI: on Windows `jdb -attach host:port` picks the shared-memory connector and
  treats "127.0.0.1:PORT" as a shared-memory name, so it exits silently. VYUHA
  now asks for the socket connector explicitly
  (`-connect com.sun.jdi.SocketAttach:hostname=…,port=…`) on every OS.

### Tests / CI

- The full test suite now runs strictly on **Windows, Linux and macOS** (it was
  Linux-only). The terminal tests run through the same shell the extension uses
  (PowerShell + `Tee-Object` on Windows), which also exercises the 4.1.3 UTF-16
  log fix for real.


## 4.1.3 — 2026-10-12

### Fixed — Windows

- **"Python was not found; run without arguments to install from the Microsoft
  Store".** VYUHA always ran `python3`, which on Windows usually does not exist —
  or is only the Microsoft Store shortcut that prints that message and exits.
  VYUHA now finds a *real* Python 3 by running it: `vyuha.pythonPath` (new
  setting) → the Python extension's chosen interpreter → `py -3` (the official
  Windows launcher) → `python` → `python3`. The Store shortcut never prints
  "Python 3.x", so it is never picked. Same for the debugger and the compiler view.
- **No Python at all → a clear message, not a red shell error.** VYUHA checks
  before running and offers Download Python, a one-command install (`winget`),
  or setting the path.
- **C/C++ on Windows:** the runner used `cc` / `c++`, which MinGW does not have;
  it now uses whichever of `gcc`/`clang`/`cc` (or `g++`/`clang++`/`c++`) works.
  Compiled programs get a `.exe` name.
- **Red `NativeCommandError` noise in the terminal.** stderr was redirected on
  the PowerShell line, which Windows PowerShell 5.1 turns into error records.
  The redirect now happens inside `cmd`, and the run terminal always opens in
  PowerShell (it uses `Tee-Object`), whatever the user's default shell is.
- **Runs never finished on Windows.** Windows PowerShell 5.1's `Tee-Object`
  writes UTF-16; the log reader assumed UTF-8, so the exit marker was never
  seen. The reader now detects UTF-16 / UTF-8 (and characters split across reads).

### Verified

- New `tests/interpreters-test.js`: fake Store stubs on PATH are rejected; with
  only the stub VYUHA reports Python missing; `vyuha.pythonPath` wins and really
  runs a program; `py -3` is tried first on Windows; UTF-16LE and UTF-8 logs
  (written 3 bytes at a time) are read correctly with the exit code.
- New `tests/extension-test.js`: on a PC with only the Store stub, Run shows the
  fix instead of starting the broken command.
- Existing suite still passes (render, DS, runner, auto, compiler tests).
- CI now runs on Windows, Linux and macOS.


## 4.1.2 — 2026-09-29

### Added
- **Debug Visualize for Java** (`src/debugviz.ts`, `runJavaDebug`). Compiles with
  `javac -g` (plus `Vyuha.java` if beside the file), starts the program in its own
  JVM with the JDWP agent (suspended, OS-chosen port) and attaches `jdb`, so the
  program's output never mixes with jdb's prompts. Each step: `where` (stack),
  `locals` (top frame), `dump` (arrays, first 40 elements). Frames in other files
  are left with `step up`; JDK code is skipped by jdb's default excludes. Package
  declarations and line numbers above 999 ("1,620") are handled. Up to 600 steps.

### Changed
- "WebGL didn't start" now also tells Linux users that the **snap** build of VS
  Code often has no GPU access and to install the `.deb` / `.rpm` (the cause on a
  real Ubuntu machine; neither the driver nor VYUHA was at fault). README gained
  a Troubleshooting section.

### Verified
- `npm run verify` passes; new tests run real `javac` + `jdb` on a recursive
  program (factorial: frames grow and shrink, locals `n`, `r`, `x`, arrays) and on
  the bundled `BinarySearch.java` with the helper beside it.


## 4.1.1 — 2026-09-29

### Fixed
- **"sh: 0: cannot open /tmp/vyuha-….sh: No such file" in the VYUHA terminal.**
  Seen on a real machine: one gesture started two runs 1 ms apart, and the second
  deleted the first run's script while the terminal was still starting (Python
  extension activating a virtual environment). Duplicate requests for the same
  file within 800 ms are now dropped, and a run's temp files are deleted two
  minutes later instead of immediately.


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
