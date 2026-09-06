# VYUHA 3.1.0 — the three requested features, built from scratch

This build adds the debugger visualization, recursion call-trees, and GIF
export **on top of** VYUHA 3.0.0. Nothing in the native 3D renderer, the frame
protocol, the compiler visualizer, or the runner table was changed — every new
feature feeds the same pipeline that was already there.

## Install (one step)

1. Open VS Code.
2. `Ctrl+Shift+P` → **Extensions: Install from VSIX…**
3. Pick `extensions/vyuha-3.1.0.vsix`.
4. Reload when prompted.

(If an older VYUHA is installed, uninstall it first so the new commands load.)

## What's new in 3.1.0

### 1. Debugger visualize — no print statements
- Open a **Python** or **C/C++** file and run **VYUHA: Debug Visualize**
  (`Ctrl+Alt+D`), or right-click → the same command.
- VYUHA runs your program under a *real debugger* and turns the live call stack
  and local variables into frames. You do **not** add a single `@vyuha` line.
  - **Python** — traced with your own `python3` (`sys.settrace`). No pip
    packages. Works everywhere Python does.
  - **C / C++** — traced with **gdb** (compiled `-g -O0`, stepped line by line).
- The call stack is drawn as a vertical tower — the running frame on top,
  callers below — with each local hanging beside its frame and updating as
  values change. Lists/arrays are drawn element by element, so you watch them
  fill and sort in 3D. Play or step the timeline like any other run.

### 2. Recursion call-trees
- In Python, `from vyuha import recursive`, then decorate:

  ```python
  from vyuha import recursive

  @recursive(name="fib(6)")
  def fib(n):
      return n if n < 2 else fib(n - 1) + fib(n - 2)

  fib(6)
  ```

- Run it with **VYUHA: Run and Visualize** (`Ctrl+Alt+V`). Each call appears the
  moment it is entered, turns active while running, and settles carrying its
  return value as the recursion unwinds. Linear, binary and mutual recursion all
  work (mutual: share one `RecursionTracer` between the functions — see the
  example's footer).
- Open **VYUHA: Open an Example → `recursion_fib.py`** to see it immediately.

### 3. Export GIF
- After any run, click **Export GIF** on the timeline (or **VYUHA: Export Run as
  GIF**). VYUHA renders every frame and writes a looping animated GIF you can
  drop into a README, slide, or submission.
- The encoder is built in and runs fully offline — no CDN, no dependency.

## What was verified before shipping

- Compiler-visualizer suite, DS renderer smoke test, protocol smoke test, and
  runner test all pass against the packaged build.
- Recursion tracer: `fib(6)` → 25 calls, tree grows and fully unwinds to 8,
  every node ending in the correct return value. Verified from the **shipped**
  helper file.
- GIF encoder: verified from the **shipped** `media/gifenc.js`. Real recursion
  frames were pushed through it end-to-end and the resulting 50-frame GIF was
  decoded and rendered back to confirm it is a valid animation.
- Python debugger: bubble sort traced in 34 steps with the call stack and array
  elements visible and reordering. Verified end-to-end.

## One honest limitation

The **C/C++ debugger path (gdb) could not be run in the build environment,
because gdb was not installed there** (only gcc/g++ were). The code uses the
standard gdb Python API and the *fallback* was verified — with no gdb it prints
a clear message instead of crashing. But the gdb path itself will run for the
first time on your machine. If you have gdb installed (`gdb --version` works),
try a small C file first. The **Python** debugger is fully verified.

Also carried over from 3.0.0, unchanged: the compiler visualizer only reflects
whatever toolchain is actually installed on your system, and PRABHA (shipped
separately) covers Turbo C graphics.

## Files in this package

```
extensions/
  vyuha-3.1.0.vsix          the installable extension
source/
  vyuha-3.1.0-source.tar.gz full TypeScript + media source
screenshots/
  recursion-calltree.png    fib(6) call tree, all frames settled
  recursion.gif             the same run exported as an animated GIF
START-HERE.md               this file
CHANGELOG-3.1.0.md          what changed
```

## Two things to do on your side (from last session, still open)

1. Push the publisher fix (`KANAKPRABHAKAR`, no space) to
   `github.com/Kanak234/vyuha` — the repo is still at 2.1.0 and its manifest has
   the space that breaks `vsce`.
2. Click through both webview panels (the VYUHA 3D view and PRABHA's canvas) in
   real VS Code before publishing to the Marketplace. The frame data is proven
   correct by independent decoding, but only a real VS Code window renders the
   panels.
