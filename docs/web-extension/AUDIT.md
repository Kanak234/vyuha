# VYUHA Web Extension Audit

**Generated:** 2026-10-19  
**Branch:** web-extension  
**Goal:** Identify all Node.js-only API usage that breaks in VS Code Web (vscode.dev / GitHub Codespaces)

---

## Summary

| Category | Files Affected | Node APIs Used |
|----------|----------------|----------------|
| **Core Extension** | `extension.ts` | `fs`, `path`, `http`, `https`, `process`, `os` (via require) |
| **Program Runner** | `runner.ts` | `child_process`, `fs`, `path`, `os`, `process` |
| **Interpreter Detection** | `interpreters.ts` | `child_process.spawnSync`, `fs`, `path`, `process` |
| **Compiler Visualization** | `compilerviz.ts` | `child_process.execFile`, `fs.promises`, `os`, `path`, `process` |
| **Debugger Visualization** | `debugviz.ts` | `child_process`, `fs`, `os`, `path`, `process` |
| **Source Analysis** | `codegraph.ts` | `path` |
| **Webview/UI** | `panel.ts`, `runview.ts`, `tree.ts`, `highlight.ts`, `spec.ts`, `protocol.ts` | **None** — pure vscode API / TypeScript |

**Total Node-only files:** 6 of 12 source files  
**Web-compatible files:** 6 of 12 source files

---

## Detailed Findings (VERIFIED)

### 1. `src/extension.ts` — Main Entry Point

| Line | API | Type | Why Used | Data Flow |
|------|-----|------|----------|-----------|
| 2 | `import * as http from 'http'` | Module import | HTTP requests to fetch live traces | → `getJson()` → `fetchLiveTrace()` → webview |
| 3 | `import * as https from 'https'` | Module import | HTTPS requests to fetch live traces | → `getJson()` → `fetchLiveTrace()` → webview |
| 4 | `import * as path from 'path'` | Module import | File path manipulation | → `runAndVisualize()`, `visualizeCompilationCmd()`, `debugVisualizeCmd()`, `runSelection()`, `runByLanguage()` |
| 5 | `import * as fs from 'fs'` | Module import | Read source files, delete temp files | → `runAndVisualize()` (read source), `removeScratch()` (cleanup) |
| 149 | `process.platform === 'win32'` | Global | Choose install command for missing compiler | → `explainMissingTool()` → user notification |
| 263 | `fs.readFileSync(file, 'utf8')` | Sync FS | Read source for auto-visualization | → `analyzeSource()` → auto frames |
| 283 | `process.platform === 'win32'` | Global | Add `-static` flag for MinGW | → `commandFor()` (runner.ts) → run command |
| 315 | `process.platform === 'win32'` | Global | Shell choice for terminal run | → `planTerminalRun()` (runner.ts) → terminal |
| 492 | `NodeJS.Timeout` | Type | Timer for terminal cleanup | → `removeScratch()` timer |
| 528 | `fs.unlinkSync(f)` | Sync FS | Delete temp script/log files | → `removeScratch()` cleanup |
| 532 | `NodeJS.Timeout` | Type | Timer reference | → `removeScratch()` timer unref |
| 875-901 | `http`/`https` modules | Module | `getJson()` fetches trace from endpoint | → `fetchLiveTrace()` → `active.applyTrace()` |
| 904 | `NodeJS.Timeout` | Type | Debounce timer type | → `debounce()` helper |
| 1064 | `require('os').tmpdir()` | Module/Global | Temp file for selection/language run | → `runSelection()`, `runByLanguage()` |
| 1065 | `fs.promises.writeFile()` | Async FS | Write selection to temp file | → `runAndVisualize(tempFile)` |
| 1093-1094 | `require('os').tmpdir()`, `fs.promises.writeFile()` | Module/Async FS | Temp file for run-by-language | → `runAndVisualize(tempFile)` |

**VERIFIED:** All items above confirmed by reading source.

---

### 2. `src/runner.ts` — Program Execution Engine

| Line | API | Type | Why Used | Data Flow |
|------|-----|------|----------|-----------|
| 1 | `import { spawn, ChildProcess } from 'child_process'` | Module import | Spawn program processes | → `RunSession.start()` → program output |
| 2 | `import * as fs from 'fs'` | Module import | Read stdin files, check helper existence | → `stdinFileFor()`, `commandFor()` (Go/Java helpers) |
| 3 | `import * as os from 'os'` | Module import | Temp directory for binaries | → `expand()` → `${bin}` placeholder |
| 4 | `import * as path from 'path'` | Module import | Path manipulation throughout | → `commandFor()`, `expand()`, `stdinFileFor()`, `planTerminalRun()` |
| 150 | `process.platform === 'win32'` | Global | Shell choice (cmd vs bash) | → `RunSession.start()` |
| 172 | `process.platform !== 'win32'` | Global | Detached process on Unix | → `RunSession.start()` |
| 174 | `process.env` | Global | Pass env vars to child (`VYUHA=1`, `PYTHONUNBUFFERED=1`) | → `RunSession.start()` |
| 283 | `process.platform === 'win32'` | Global | Add `-static` for MinGW | → `commandFor()` |
| 342 | `process.pid` | Global | Unique temp file names | → `planTerminalRun()` |
| 342 | `process.platform === 'win32'` | Global | Windows vs Unix script | → `planTerminalRun()` |
| 342 | `process.env` | Global | Pass through env | → `planTerminalRun()` |
| 457 | `process.pid` | Global | Unique temp directory | → `planTerminalRun()` |
| 458 | `os.tmpdir()` | Module | Temp directory for scripts/logs | → `planTerminalRun()` |
| 460 | `process.platform === 'win32'` | Global | Windows batch vs Unix shell | → `planTerminalRun()` |
| 472 | `fs.writeFileSync()` | Sync FS | Write Windows batch script | → `planTerminalRun()` |
| 485 | `fs.writeFileSync()` | Sync FS | Write Unix shell script | → `planTerminalRun()` |
| 495 | `fs.chmodSync()` | Sync FS | Make shell script executable | → `planTerminalRun()` |
| 512 | `fs.statSync()` | Sync FS | Check `script` command exists | → `hasScriptCommand()` |
| 572 | `fs.statSync()` | Sync FS | Poll log file size | → `LogTail.poll()` |
| 578 | `fs.openSync()` | Sync FS | Open log file for reading | → `LogTail.poll()` |
| 581 | `fs.readSync()` | Sync FS | Read log file chunk | → `LogTail.poll()` |
| 582 | `fs.closeSync()` | Sync FS | Close file descriptor | → `LogTail.poll()` |
| 123 | `NodeJS.Timeout` | Type | Kill timer for timeout | → `RunSession.start()` |
| 201 | `setTimeout()` with `NodeJS.Timeout` | Global | Program timeout | → `RunSession.start()` |
| 369 | `fs.existsSync()` | Sync FS | Check stdin file exists | → `stdinFileFor()` |
| 291 | `fs.existsSync()` | Sync FS | Check Go/Java helper exists | → `commandFor()` |
| 303 | `fs.readFileSync()` | Sync FS | Read Java file for package | → `javaMainClass()` |
| 485 | `fs.statSync()` | Sync FS | Check compiler binary | → `resolveCCompiler()` (via interpreters.ts) |

**VERIFIED:** All items above confirmed by reading source.

---

### 3. `src/interpreters.ts` — Python/C/C++ Tool Detection

| Line | API | Type | Why Used | Data Flow |
|------|-----|------|----------|-----------|
| 22 | `import { spawnSync } from 'child_process'` | Module import | Probe interpreter versions | → `probePython()`, `resolveCCompiler()` |
| 23 | `import * as fs from 'fs'` | Module import | Check if candidate is a file path | → `split()` |
| 24 | `import * as path from 'path'` | Module import | (Unused directly but imported) | — |
| 49 | `fs.existsSync(c)` | Sync FS | Distinguish path from command name | → `split()` |
| 59 | `spawnSync(cmd, [...args, '--version'])` | Sync Child Process | Run `--version` to verify real Python | → `probePython()` |
| 75 | `process.platform === 'win32'` | Global | Windows vs Unix candidate order | → `resolvePython()` |
| 91 | `process.platform === 'win32'` | Global | Windows vs Unix candidate order | → `resolveCCompiler()` |
| 97 | `spawnSync(c, ['--version'])` | Sync Child Process | Verify compiler exists | → `resolveCCompiler()` |
| 110 | `process.platform === 'win32'` | Global | Windows install hint | → `pythonInstallHint()` |
| 117 | `process.platform === 'darwin'` | Global | macOS install hint | → `pythonInstallHint()` |

**VERIFIED:** All items above confirmed by reading source.

---

### 4. `src/compilerviz.ts` — Compiler Pipeline Visualization

| Line | API | Type | Why Used | Data Flow |
|------|-----|------|----------|-----------|
| 26 | `import { execFile } from 'child_process'` | Module import | Run compiler stages | → `run()`, `cFamily()`, `javaPipeline()`, etc. |
| 27 | `import * as fs from 'fs'` | Module import | Read/write pipeline artifacts | → `sizeOf()`, `cFamily()`, `visualizeCompilation()` |
| 28 | `import * as os from 'os'` | Module import | Temp workspace directory | → `visualizeCompilation()` |
| 29 | `import * as path from 'path'` | Module import | Artifact paths | → `cFamily()`, `javaPipeline()`, etc. |
| 54 | `process.execPath` | Global | Run Node to find free port | → `freePort()` |
| 55-56 | `process.env` + `ELECTRON_RUN_AS_NODE` | Global | Run Node in Electron context | → `freePort()` |
| 64 | `process.platform === 'win32'` | Global | `where` vs `which` | → `which()` |
| 65 | `execFileSync(probe, [cmd])` | Sync Child Process | Find absolute path of tool | → `which()` |
| 179 | `fs.promises.stat()` | Async FS | Get artifact file size | → `sizeOf()` |
| 180 | `fs.promises.readFile()` | Async FS | Read source/preprocessed/assembly | → `cFamily()`, `pythonPipeline()` |
| 218 | `fs.promises.readFile()` | Async FS | Read source file | → `cFamily()` |
| 232 | `fs.promises.readFile()` | Async FS | Read preprocessed output | → `cFamily()` |
| 249 | `fs.promises.readFile()` | Async FS | Read assembly output | → `cFamily()` |
| 331 | `which('javap')` | Async Child Process | Find javap for bytecode analysis | → `javaPipeline()` |
| 367-368 | `run(py.cmd, ...)` | Async Child Process | Python bytecode compilation | → `pythonPipeline()` |
| 379-388 | `run(py.cmd, ...)` | Async Child Process | Python bytecode counting | → `pythonPipeline()` |
| 401 | `run(py.cmd, ...)` | Async Child Process | Run Python program | → `pythonPipeline()` |
| 423 | `run(node.cmd, ...)` | Async Child Process | Node --check / run | → `nodePipeline()` |
| 437 | `run('npx', ...)` | Async Child Process | Run TypeScript via tsx | → `nodePipeline()` |
| 459 | `run(go.cmd, ...)` | Async Child Process | Go build | → `goPipeline()` |
| 472 | `run(bin, ...)` | Async Child Process | Run Go binary | → `goPipeline()` |
| 497 | `run(sh[0], ...)` | Async Child Process | Generic shell command | → `genericPipeline()` |
| 541 | `fs.promises.mkdtemp()` | Async FS | Create temp workspace | → `visualizeCompilation()` |
| 66 | `os.tmpdir()` | Module | Base temp directory | → `which()`, `visualizeCompilation()` |

**VERIFIED:** All items above confirmed by reading source.

---

### 5. `src/debugviz.ts` — Debugger-Driven Visualization

| Line | API | Type | Why Used | Data Flow |
|------|-----|------|----------|-----------|
| 25 | `import { execFile, execFileSync, spawn } from 'child_process'` | Module import | Run debuggers (Python tracer, GDB, jdb) | → `runPythonDebug()`, `runGdbDebug()`, `runJavaDebug()` |
| 26 | `import * as fs from 'fs'` | Module import | Write tracer script, read files, cleanup | → `runPythonDebug()`, `runGdbDebug()`, `runJavaDebug()` |
| 27 | `import * as os from 'os'` | Module import | Temp directories | → `runPythonDebug()`, `runGdbDebug()`, `runJavaDebug()`, `freePort()` |
| 28 | `import * as path from 'path'` | Module import | Path construction | → Throughout |
| 54 | `process.execPath` | Global | Run Node to find free port | → `freePort()` |
| 55-56 | `process.env` + `ELECTRON_RUN_AS_NODE` | Global | Run Node in Electron context | → `freePort()` |
| 63-66 | `execFileSync(probe, [cmd])` | Sync Child Process | Find gdb/javac/jdb/java | → `which()` |
| 101 | `process.platform === 'win32'` | Global | Windows vs Unix jdb connect | → `driveJdb()` |
| 276 | `process.pid` | Global | Unique tracer filename | → `runPythonDebug()` |
| 277 | `fs.writeFileSync()` | Sync FS | Write embedded Python tracer | → `runPythonDebug()` |
| 279-281 | `spawn(py, ...)` with `process.env` | Async Child Process | Run Python with tracer | → `runPythonDebug()` |
| 311 | `fs.unlinkSync()` | Sync FS | Cleanup tracer script | → `runPythonDebug()` |
| 333 | `which('g++')` / `which('clang++')` | Sync Child Process | Find C++ compiler | → `runGdbDebug()` |
| 334 | `which('gcc')` / `which('clang')` | Sync Child Process | Find C compiler | → `runGdbDebug()` |
| 342 | `fs.mkdtempSync()` | Sync FS | Temp workspace for GDB | → `runGdbDebug()` |
| 346 | `execFile(cc, ...)` | Async Child Process | Compile with debug info | → `runGdbDebug()` |
| 354 | `spawn(gdb, ...)` | Async Child Process | Run GDB batch | → `driveGdb()` |
| 450 | `fs.writeFileSync()` | Sync FS | Write GDB command script | → `driveGdb()` |
| 480 | `fs.rmSync()` | Sync FS | Cleanup GDB workspace | → `driveGdb()` |
| 530 | `fs.mkdtempSync()` | Sync FS | Temp workspace for jdb | → `runJavaDebug()` |
| 534 | `fs.existsSync()` | Sync FS | Check Vyuha.java helper | → `runJavaDebug()` |
| 538 | `execFile(javac, ...)` | Async Child Process | Compile with debug info | → `runJavaDebug()` |
| 546 | `spawn(jdb, ...)` | Async Child Process | Run jdb attach | → `driveJdb()` |
| 555 | `which('java')` | Sync Child Process | Find java for JVM | → `driveJdb()` |
| 594 | `spawn(java, ...)` | Async Child Process | Launch JVM with JDWP | → `driveJdb()` |
| 616 | `fs.rmSync()` | Sync FS | Cleanup jdb workspace | → `driveJdb()` |
| 281 | `process.env` | Global | Pass `VYUHA_MAX_STEPS` | → `runPythonDebug()` |
| 342 | `os.tmpdir()` | Module | Base temp directory | → `runGdbDebug()`, `runJavaDebug()` |
| 530 | `os.tmpdir()` | Module | Base temp directory | → `runJavaDebug()` |
| 54 | `process.execPath` | Global | Node binary for freePort | → `freePort()` |

**VERIFIED:** All items above confirmed by reading source.

---

### 6. `src/codegraph.ts` — Source Code Analysis

| Line | API | Type | Why Used | Data Flow |
|------|-----|------|----------|-----------|
| 20 | `import * as path from 'path'` | Module import | File basename, extension | → `analyzeSource()`, `languageOf()`, `autoFrame()` |
| 58 | `path.extname(file)` | Module | Detect language from extension | → `languageOf()` |
| 113 | `path.basename(file)` | Module | File node label | → `analyzeSource()` |
| 339 | `path.basename(file)` | Module | Module | → `autoFrame()` (only in title) |
| 419 | `path.basename(cg.file)` | Module | Frame title | → `autoFrame()` |

**VERIFIED:** All items above confirmed by reading source.

---

### 7. Files WITHOUT Node-only APIs (Web-Compatible) ✅

| File | Status | Notes |
|------|--------|-------|
| `src/panel.ts` | ✅ Web-compatible | Only `vscode` imports |
| `src/runview.ts` | ✅ Web-compatible | Only `vscode` imports, `Math.random()` |
| `src/protocol.ts` | ✅ Web-compatible | Pure TypeScript, no imports |
| `src/spec.ts` | ✅ Web-compatible | Pure TypeScript, no imports |
| `src/tree.ts` | ✅ Web-compatible | Only `vscode` imports |
| `src/highlight.ts` | ✅ Web-compatible | Only `vscode` imports |

---

## Features That CANNOT Work on the Web

| Feature | Reason | Affected Commands |
|---------|--------|-------------------|
| **Run arbitrary programs** (any language) | Requires `child_process.spawn`, filesystem access, shell | `vyuha.runAndVisualize`, `vyuha.runSelection`, `vyuha.runByLanguage`, `vyuha.rerun` |
| **Terminal-based runs** | Requires `vscode.window.createTerminal`, `child_process`, PTY | `vyuha.runAndVisualize` (when `vyuha.runInTerminal=true`) |
| **Compiler visualization** | Requires running `gcc`, `javac`, `python -m py_compile`, etc. | `vyuha.visualizeCompilation` |
| **Debugger visualization** | Requires `sys.settrace` (Python), `gdb` (C/C++), `jdb` (Java) | `vyuha.debugVisualize` |
| **Fetch live trace from HTTP endpoint** | Requires `http`/`https` modules (but **can be replaced** with `fetch`) | `vyuha.fetchLiveTrace` |
| **Add helper library** | Requires `vscode.workspace.fs.readFile` from extension bundle (works on web!) | `vyuha.addHelperLibrary` — **actually works on web** |
| **Open bundled examples** | Requires `vscode.workspace.fs.readDirectory` (works on web!) | `vyuha.openExample` — **actually works on web** |
| **Export trace/GIF** | Requires `vscode.workspace.fs.writeFile` + save dialog (works on web!) | `vyuha.exportTrace`, `vyuha.exportGif` — **actually works on web** |
| **Open graph spec files** | Custom editor provider works on web | `vyuha.open` — **works on web** |
| **Neural network inference/visualization** | Pure webview/Three.js, no Node APIs | `vyuha.runInference`, `vyuha.newInput`, `vyuha.tracePath` — **works on web** |

---

## Features That CAN Work on the Web (with current code or minimal changes)

| Feature | Status | Notes |
|---------|--------|-------|
| **Graph spec editor** (`.vyuha.json`, `.netgraph.json`) | ✅ Works | CustomTextEditorProvider uses only vscode API |
| **Neural network visualization** | ✅ Works | Three.js in webview, no Node deps |
| **Data structure visualization from @vyuha prints** | ⚠️ Partial | Needs a program runner — but can visualize **pre-recorded traces** |
| **Timeline playback (frames)** | ✅ Works | Pure webview |
| **Layer tree view** | ✅ Works | TreeDataProvider uses only vscode API |
| **Source highlighting (double-tap node)** | ✅ Works | `vscode.window.showTextDocument`, decorations |
| **Configuration/settings** | ✅ Works | `vscode.workspace.getConfiguration` |
| **Export trace/GIF to workspace** | ✅ Works | `vscode.workspace.fs.writeFile` + save dialog |
| **Fetch live trace** | ⚠️ Fixable | Replace `http`/`https` with `fetch` API |

---

## Open Questions

1. **Should the web extension include a WASM-based runner?** (e.g., Pyodide for Python, wasm3 for C) — This would enable "Run and Visualize" on the web but significantly increases bundle size.

2. **Can `vscode.workspace.fs.readFile` read from the extension's bundled `lib/` and `examples/` on the web?** — Need to verify `context.extensionUri` works in web context.

3. **Does `vscode.window.createWebviewPanel` with `retainContextWhenHidden` work identically on web?** — Three.js WebGL context loss behavior may differ.

4. **Should the web build exclude `debugviz.ts`, `compilerviz.ts`, `runner.ts`, `interpreters.ts` entirely?** — They pull in `child_process` which will cause esbuild to fail unless externalized or excluded.

5. **What about the `http`/`https` import in `extension.ts` for `fetchLiveTrace`?** — Can be replaced with global `fetch` (available in web extension host).

---

## Replacement Strategy (for PLAN.md)

| Node API | Web Replacement |
|----------|-----------------|
| `fs.readFileSync` / `fs.promises.readFile` | `vscode.workspace.fs.readFile` |
| `fs.writeFileSync` / `fs.promises.writeFile` | `vscode.workspace.fs.writeFile` |
| `fs.unlinkSync` / `fs.promises.unlink` | `vscode.workspace.fs.delete` |
| `fs.statSync` / `fs.promises.stat` | `vscode.workspace.fs.stat` |
| `fs.existsSync` | `vscode.workspace.fs.stat` + catch |
| `fs.mkdtempSync` / `fs.promises.mkdtemp` | **No direct equivalent** — use `vscode.workspace.fs.createDirectory` in a unique subpath |
| `path.join`, `path.dirname`, `path.basename`, `path.extname` | **Polyfill** or use `vscode.Uri` joinPath / path manipulation |
| `os.tmpdir()` | **No equivalent** — web has no persistent temp dir; use workspace storage or in-memory |
| `process.platform` | `navigator.userAgent` check or `vscode.env.uiKind` — but **branching by platform makes no sense on web** |
| `process.pid` | **No equivalent** — use `Date.now() + Math.random()` for uniqueness |
| `process.env` | **No equivalent** — settings via `vscode.workspace.getConfiguration` |
| `child_process.spawn/execFile` | **No equivalent** — cannot run native binaries in browser |
| `child_process.spawnSync/execFileSync` | **No equivalent** |
| `http`/`https` modules | Global `fetch()` API |
| `NodeJS.Timeout` | `ReturnType<typeof setTimeout>` (standard web type) |

---

## Next Steps

1. **Write PLAN.md** with concrete replacement strategy per file
2. **Create `src/web/extension.ts`** that activates only web-compatible commands
3. **Add esbuild config** with `platform: 'browser'`, `format: 'cjs'`, externalizing `vscode`
4. **Add `"browser"` field** in `package.json` pointing to web build output
5. **Test with `@vscode/test-web`**