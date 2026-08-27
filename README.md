# VYUHA

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

Every payload also accepts `title`, `note`, and `line` (a source line number — clicking a node then jumps there).

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
