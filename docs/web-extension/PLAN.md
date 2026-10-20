# VYUHA Web Extension Plan

**Based on:** AUDIT.md  
**Goal:** Create a functional VS Code Web extension (vscode.dev / GitHub Codespaces) that preserves all web-compatible features while gracefully disabling Node-only features.

---

## Strategy Overview

| Approach | Description |
|----------|-------------|
| **Single codebase, conditional imports** | Keep `src/extension.ts` for desktop; create `src/web/extension.ts` for web that only imports web-compatible modules |
| **Shared modules** | `panel.ts`, `runview.ts`, `protocol.ts`, `spec.ts`, `tree.ts`, `highlight.ts` work unchanged on both |
| **Desktop-only modules** | `runner.ts`, `interpreters.ts`, `compilerviz.ts`, `debugviz.ts`, `codegraph.ts` (uses `path`) — excluded from web build |
| **Polyfills needed** | Minimal: `path` functions for `codegraph.ts` auto-frame title, `fetch` for `fetchLiveTrace` |

---

## File-by-File Plan

### 1. `package.json` — Add Web Entry Point

**Changes:**
- Add `"browser": "./dist/web/extension.js"` field
- Add esbuild script for web build
- Keep `"main": "./out/extension.js"` for desktop

```json
{
  "main": "./out/extension.js",
  "browser": "./dist/web/extension.js",
  "scripts": {
    "compile": "tsc -p ./",
    "compile:web": "esbuild src/web/extension.ts --bundle --platform=browser --format=cjs --outfile=dist/web/extension.js --external:vscode --target=es2020",
    "vscode:prepublish": "npm run vendor && npm run compile && npm run compile:web"
  }
}
```

**Why:** VS Code Web loads the `browser` field entry point. esbuild with `platform=browser` excludes Node built-ins and bundles only what's needed. `--external:vscode` keeps `require('vscode')` as external (provided by host).

---

### 2. `src/web/extension.ts` — Web Entry Point (NEW FILE)

**Purpose:** Activate only web-compatible commands and views.

**Imports (ONLY web-compatible):**
```typescript
import * as vscode from 'vscode';
import { GraphEditorProvider, GraphView, ViewEvent } from '../panel';
import { LayerTree } from '../tree';
import { layerAtLine, templateSpec } from '../spec';
import { SourceHighlighter } from '../highlight';
```

**Commands to REGISTER (work on web):**

| Command | Handler | Why It Works |
|---------|---------|--------------|
| `vyuha.open` | `openActiveDocument` | Custom editor + webview only |
| `vyuha.runInference` | `active.run('run')` | Pure webview/Three.js |
| `vyuha.newInput` | `active.run('newInput')` | Pure webview |
| `vyuha.tracePath` | `active.run('trace')` | Pure webview |
| `vyuha.exportTrace` | `saveTrace` | `vscode.workspace.fs.writeFile` + save dialog |
| `vyuha.fetchLiveTrace` | `fetchLiveTrace` | **Replace http/https with fetch()** |
| `vyuha.newSpecFile` | `newSpecFile` | Creates untitled JSON doc |
| `vyuha.focusLayer` | `active.focus()` | Webview message |
| `vyuha.revealLayer` | `revealLayer` | `vscode.window.showTextDocument` + decorations |
| `vyuha.gotoFrame` | `runView.gotoFrame()` | Timeline navigation (if frames exist) |
| `vyuha.playPause` | `runView.command('playPause')` | Timeline control |
| `vyuha.stepNext` / `vyuha.stepPrev` | `runView.command('next'/'prev')` | Timeline control |
| `vyuha.addHelperLibrary` | `addHelperLibrary` | `vscode.workspace.fs.readFile` from extension bundle |
| `vyuha.openExample` | `openExample` | `vscode.workspace.fs.readDirectory` from extension bundle |
| `vyuha.exportGif` | `exportRunGif` / `saveGif` | `vscode.workspace.fs.writeFile` (base64 from webview) |

**Commands to OMIT (require Node):**

| Command | Reason |
|---------|--------|
| `vyuha.runAndVisualize` | Needs `child_process`, `fs`, `path`, `os` |
| `vyuha.stopRun` | Needs active `RunSession`/`LogTail` |
| `vyuha.rerun` | Needs `lastRunFile` from desktop run |
| `vyuha.showOutput` | Output channel works but no program runs to show |
| `vyuha.visualizeCompilation` | Needs compilers, `child_process`, `fs`, `os` |
| `vyuha.debugVisualize` | Needs `gdb`/`jdb`/Python tracer, `child_process` |
| `vyuha.runSelection` | Needs temp file + runner |
| `vyuha.runByLanguage` | Needs temp file + runner |
| `vyuha.openCompileArtifact` | Needs `lastPipeline` from compiler viz |

**Views to REGISTER (same as desktop):**
- Custom Editor: `vyuha.editor` for `.vyuha.json` / `.netgraph.json`
- Tree View: `vyuha.layers` (Structure sidebar)
- Activity Bar: `vyuha` icon

**Event Listeners (same as desktop):**
- `onDidChangeTextDocument` → refresh graph view
- `onDidChangeConfiguration` → push config to views
- `onDidChangeTextEditorSelection` → sync cursor to layer (if `vyuha.syncCursor`)

---

### 3. `src/fetchLiveTrace.ts` — Fetch Replacement (NEW FILE)

**Purpose:** Replace `http`/`https` with `fetch` for web compatibility.

```typescript
// src/fetchLiveTrace.ts
export async function fetchJson(url: string): Promise<unknown> {
  const response = await fetch(url, {
    method: 'GET',
    headers: { 'Accept': 'application/json' },
    signal: AbortSignal.timeout(4000)
  });
  if (!response.ok) {
    throw new Error(`The server answered ${response.status}.`);
  }
  return response.json();
}
```

**Usage in `src/web/extension.ts`:**
```typescript
import { fetchJson } from './fetchLiveTrace';

async function fetchLiveTrace() {
  const endpoint = vscode.workspace.getConfiguration('vyuha').get<string>('traceEndpoint', '').trim();
  if (!endpoint) { /* ... */ }
  if (!active) { /* ... */ }
  try {
    const body = await fetchJson(endpoint);
    active.applyTrace(body);
    vscode.window.setStatusBarMessage('$(cloud-download) Trace pulled from ' + endpoint, 2500);
  } catch (err) { /* ... */ }
}
```

**Why:** `fetch` is global in web extension host. `AbortSignal.timeout` replaces manual timeout handling.

---

### 4. `src/codegraph.ts` — Path Polyfill (MINIMAL CHANGE)

**Problem:** `codegraph.ts` uses `path.basename` and `path.extname` only for:
- `languageOf(file)` → detect language from extension
- `autoFrame()` title → `path.basename(cg.file)`

**Solution:** Add a tiny path helper used only by web build, or inline the logic.

**Option A: Inline in `codegraph.ts` (no new file, works everywhere)**
```typescript
// Replace: import * as path from 'path';
// With inline helpers:
function extname(file: string): string {
  const i = file.lastIndexOf('.');
  const s = file.lastIndexOf('/');
  const b = file.lastIndexOf('\\');
  const lastSep = Math.max(s, b);
  return i > lastSep ? file.slice(i) : '';
}
function basename(file: string): string {
  const s = file.lastIndexOf('/');
  const b = file.lastIndexOf('\\');
  const lastSep = Math.max(s, b);
  return file.slice(lastSep + 1);
}
```

**Option B: Create `src/util/path.ts` polyfill, import conditionally**

**Decision:** Option A — simpler, zero dependencies, same behavior. The functions are trivial and used in only 3 places.

---

### 5. `src/web/extension.ts` — Full Implementation Outline

```typescript
// src/web/extension.ts
import * as vscode from 'vscode';
import { GraphEditorProvider, GraphView, ViewEvent } from '../panel';
import { RunView, RunEvent } from '../runview';
import { layerAtLine, templateSpec } from '../spec';
import { LayerTree } from '../tree';
import { SourceHighlighter } from '../highlight';
import { fetchJson } from './fetchLiveTrace';

// ... same global state as desktop but NO:
// - RunSession, LogTail, terminal, child_process
// - runner.ts, interpreters.ts, compilerviz.ts, debugviz.ts
// - codegraph.ts (auto-visualization needs runner)

// Only these commands:
const WEB_COMMANDS = [
  'vyuha.open',
  'vyuha.runInference',
  'vyuha.newInput',
  'vyuha.tracePath',
  'vyuha.exportTrace',
  'vyuha.fetchLiveTrace',
  'vyuha.newSpecFile',
  'vyuha.focusLayer',
  'vyuha.revealLayer',
  'vyuha.gotoFrame',
  'vyuha.playPause',
  'vyuha.stepNext',
  'vyuha.stepPrev',
  'vyuha.addHelperLibrary',
  'vyuha.openExample',
  'vyuha.exportGif',
] as const;

// activate() registers ONLY web commands + views + listeners
// deactivate() cleans up views
```

---

### 6. `tsconfig.json` — No Changes Needed

**Why:** TypeScript compiles `src/web/extension.ts` with same settings. esbuild handles bundling for web. The `outDir` stays `out/` for desktop; web build outputs to `dist/web/`.

---

### 7. `esbuild` Config Details

```bash
npx esbuild src/web/extension.ts \
  --bundle \
  --platform=browser \
  --format=cjs \
  --outfile=dist/web/extension.js \
  --external:vscode \
  --target=es2020 \
  --sourcemap
```

**Key flags:**
- `--platform=browser` — Excludes Node built-ins (`fs`, `path`, `child_process`, etc.) from bundle; errors if they're imported
- `--external:vscode` — Keeps `require('vscode')` as external (provided by VS Code host)
- `--format=cjs` — VS Code Web expects CommonJS entry point
- `--target=es2020` — Modern JS, supports `fetch`, `AbortSignal.timeout`

**If any Node-only import slips through:** esbuild will error → forces clean separation.

---

### 8. Media Files (Three.js, etc.)

**No changes needed.** The `media/` folder is served via `webview.asWebviewUri()` which works identically on desktop and web. `localResourceRoots` points to `extensionUri` + `media` — works on web because the extension bundle includes `media/`.

---

### 9. Bundled Resources (`lib/`, `examples/`)

**Verification needed:** `vscode.workspace.fs.readFile(vscode.Uri.joinPath(context.extensionUri, 'lib', 'vyuha.py'))` — `context.extensionUri` on web points to the unpacked extension in the web host. This **should work** because the `.vsix` includes all files under `media/`, `lib/`, `examples/`.

**Test:** `addHelperLibrary` and `openExample` commands in web extension.

---

### 10. Features Disabled on Web (Graceful Degradation)

| Feature | Web Behavior |
|---------|--------------|
| Run and Visualize | Command hidden (not registered) — user sees no menu item |
| Compiler Visualize | Command hidden |
| Debug Visualize | Command hidden |
| Run Selection / By Language | Command hidden |
| Terminal integration | Not applicable |
| Auto-visualization of plain programs | Not available (needs runner) |
| Pre-recorded trace visualization | **Works** — open `.vyuha.json` or load trace via `vyuha.exportTrace` / `vyuha.fetchLiveTrace` |

**UI Hint:** In `viewsWelcome` content (package.json), the web extension could show a note: *"Running programs requires desktop VS Code. On the web, open a trace file or graph spec to visualize."*

---

## Build & Test Commands

```bash
# 1. Install deps (includes esbuild)
npm install

# 2. Build desktop (unchanged)
npm run compile

# 3. Build web
npm run compile:web

# 4. Verify web bundle exists and has no Node imports
ls -la dist/web/extension.js
# Should NOT contain: "fs", "path", "child_process", "os", "http", "https"

# 5. Test in web environment
npx @vscode/test-web --extensionDevelopmentPath=. --browserType=chromium
```

---

## Expected Test Results

| Test | Expected |
|------|----------|
| Extension activates on vscode.dev | ✅ |
| Activity bar icon appears | ✅ |
| Tree view "Structure" loads | ✅ |
| Open `.vyuha.json` file → graph view | ✅ |
| Three.js renders network | ✅ (WebGL required) |
| Play/pause/step timeline | ✅ |
| Double-tap node → reveal in editor | ✅ |
| Export trace/GIF | ✅ |
| Fetch live trace (HTTP) | ✅ (with fetch replacement) |
| Add helper library | ✅ |
| Open example | ✅ |
| Run and Visualize | ❌ (command not registered) |
| Compiler/Debug visualize | ❌ (commands not registered) |

---

## Open Questions (from Audit)

1. **WASM runner?** — Deferred. Current plan: web extension = visualization only. Running programs stays desktop-only.
2. **`context.extensionUri` on web?** — Assume yes; verify during test.
3. **WebGL in webview on vscode.dev?** — Works if browser supports WebGL; snap/flatpak issues don't apply to web.
4. **`vscode.window.createTerminal` on web?** — Returns `undefined` or throws; not used in web build.
5. **Settings sync?** — `vyuha.runners`, `vyuha.pythonPath` etc. still exist in settings but unused on web. Harmless.

---

## Handoff Checklist

- [ ] `package.json` has `"browser"` field and `compile:web` script
- [ ] `src/web/extension.ts` created with web-only commands
- [ ] `src/fetchLiveTrace.ts` created
- [ ] `src/codegraph.ts` inlined path helpers (or polyfill)
- [ ] `npm run compile:web` succeeds with no Node import errors
- [ ] `npx @vscode/test-web` launches and extension activates
- [ ] All web-compatible commands work manually
- [ ] HANDOFF.md written with real command output