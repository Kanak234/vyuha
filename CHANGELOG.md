# Changelog

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
