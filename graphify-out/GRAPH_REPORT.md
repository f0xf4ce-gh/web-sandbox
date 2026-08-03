# Graph Report - .  (2026-08-03)

## Corpus Check
- Corpus is ~19,737 words - fits in a single context window. You may not need a graph.

## Summary
- 359 nodes · 534 edges · 18 communities (16 shown, 2 thin omitted)
- Extraction: 93% EXTRACTED · 7% INFERRED · 0% AMBIGUOUS · INFERRED: 36 edges (avg confidence: 0.76)
- Token cost: 0 input · 0 output

## Community Hubs (Navigation)
- UI Base Runtime
- Frontend Workspace Shell
- PTY Session Backend
- Dual Preview Interface
- Server Dependency Stack
- Container Runtime Isolation
- Injected Preview Client
- Preview Serving and Fixture
- Frontend Dependencies
- Inject TypeScript Config
- Server TypeScript Config
- Client TypeScript Config
- Terminal Smoke Checks
- Sandbox CLI
- 192 Terminal Icon
- 512 Terminal Icon

## God Nodes (most connected - your core abstractions)
1. `Web dev sandbox` - 19 edges
2. `mountViewer()` - 11 edges
3. `attachWebsocketRoutes()` - 10 edges
4. `servePreview()` - 9 edges
5. `WorkspaceWatcher` - 9 edges
6. `compilerOptions` - 9 edges
7. `compilerOptions` - 9 edges
8. `compilerOptions` - 9 edges
9. `walk()` - 9 edges
10. `walkXImport()` - 9 edges

## Surprising Connections (you probably didn't know these)
- `Persistent workspace volume` --shares_data_with--> `PtySessionStore`  [INFERRED]
  compose.yaml → server/pty.ts
- `Web dev sandbox` --references--> `ViewerController`  [INFERRED]
  README.md → client/panes/viewer.ts
- `Web dev sandbox` --references--> `hotSwapStylesheet()`  [INFERRED]
  README.md → inject/client.ts
- `Locally served static files` --implements--> `servePreview()`  [INFERRED]
  fixtures/preview-check/index.html → server/preview.ts
- `Web dev sandbox` --references--> `servePreview()`  [INFERRED]
  README.md → server/preview.ts

## Import Cycles
- None detected.

## Communities (18 total, 2 thin omitted)

### Community 0 - "UI Base Runtime"
Cohesion: 0.07
Nodes (52): boot(), cdnScriptFor(), collectProps(), compileAttr(), compileTemplate(), contentKey(), createComponentFactory(), createExternalModules() (+44 more)

### Community 1 - "Frontend Workspace Shell"
Cohesion: 0.05
Nodes (39): accessory, applySplitStyles(), consoleCollapse, consoleController, consoleHeight, horizontalSplit, mobileTabs, moveSplitDrag() (+31 more)

### Community 2 - "PTY Session Backend"
Cohesion: 0.10
Nodes (24): port, sessions, watcher, ClientMessage, isSessionId(), newSessionId(), parseClientMessage(), PtySession (+16 more)

### Community 3 - "Dual Preview Interface"
Cohesion: 0.09
Nodes (31): Block external requests control, Console pane, Desktop width-based viewport, Link scroll control, Mobile width-based viewport, QR preview action, Terminal pane, Viewer pane (+23 more)

### Community 4 - "Server Dependency Stack"
Cohesion: 0.07
Nodes (27): chokidar, fastify, @fastify/cookie, @fastify/http-proxy, @fastify/static, @fastify/websocket, node-pty, dependencies (+19 more)

### Community 5 - "Container Runtime Isolation"
Cohesion: 0.10
Nodes (25): App service, Caddy edge service, Online dependency profile, Runtime privilege restrictions, Internal sandbox network, Online bridge network, Web dev sandbox Compose stack, Persistent workspace volume (+17 more)

### Community 6 - "Injected Preview Client"
Cohesion: 0.14
Nodes (22): ChangeMessage, connectEvents(), ConsoleLevel, context, decodePart(), EarlyConsoleMessage, getPreviewContext(), handleChange() (+14 more)

### Community 7 - "Preview Serving and Fixture"
Cohesion: 0.15
Nodes (19): Console log button, Locally served static files, Preserved form state, Preview check fixture, CSS hot swapping, previewHandler(), applyPreviewHeaders(), contentType() (+11 more)

### Community 8 - "Frontend Dependencies"
Cohesion: 0.11
Nodes (19): @fontsource/inter, @fontsource/jetbrains-mono, devDependencies, @fontsource/inter, @fontsource/jetbrains-mono, @types/node, @types/ws, typescript (+11 more)

### Community 9 - "Inject TypeScript Config"
Cohesion: 0.13
Nodes (14): inject/**/*.ts, compilerOptions, declaration, module, moduleResolution, noEmit, outDir, rootDir (+6 more)

### Community 10 - "Server TypeScript Config"
Cohesion: 0.13
Nodes (14): node, server/**/*.ts, compilerOptions, declaration, module, moduleResolution, noEmit, outDir (+6 more)

### Community 11 - "Client TypeScript Config"
Cohesion: 0.14
Nodes (13): client/**/*.ts, vite.config.ts, compilerOptions, module, moduleResolution, noEmit, skipLibCheck, strict (+5 more)

### Community 12 - "Terminal Smoke Checks"
Cohesion: 0.40
Nodes (3): baseUrl, sessionUrl, socketUrl

### Community 13 - "Sandbox CLI"
Cohesion: 0.83
Nodes (3): die(), sandbox.sh script, usage()

## Knowledge Gaps
- **124 isolated node(s):** `shell`, `themeIcon`, `themeMeta`, `mobileTabs`, `accessory` (+119 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **2 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `Web dev sandbox` connect `Container Runtime Isolation` to `Frontend Workspace Shell`, `PTY Session Backend`, `Dual Preview Interface`, `Injected Preview Client`, `Preview Serving and Fixture`?**
  _High betweenness centrality (0.177) - this node is a cross-community bridge._
- **Why does `hotSwapStylesheet()` connect `Injected Preview Client` to `Container Runtime Isolation`?**
  _High betweenness centrality (0.057) - this node is a cross-community bridge._
- **Why does `attachWebsocketRoutes()` connect `PTY Session Backend` to `Container Runtime Isolation`?**
  _High betweenness centrality (0.052) - this node is a cross-community bridge._
- **Are the 8 inferred relationships involving `Web dev sandbox` (e.g. with `console.ts` and `terminal.ts`) actually correct?**
  _`Web dev sandbox` has 8 INFERRED edges - model-reasoned connections that need verification._
- **What connects `shell`, `themeIcon`, `themeMeta` to the rest of the system?**
  _124 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `UI Base Runtime` be split into smaller, more focused modules?**
  _Cohesion score 0.0673076923076923 - nodes in this community are weakly interconnected._
- **Should `Frontend Workspace Shell` be split into smaller, more focused modules?**
  _Cohesion score 0.05102040816326531 - nodes in this community are weakly interconnected._