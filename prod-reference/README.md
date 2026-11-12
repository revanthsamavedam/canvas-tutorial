# prod-reference — production outer shell + bridge

Reference copies of the real production files, so you can compare what you
build in parts 01–02 against the code that actually ships. Read-only: the
live code stays in `agent-docs-ui` and `canvas-bridge`; this folder is a
snapshot, not a second source of truth.

Snapshotted 2026-11-11 from the local working copies.

## What's here

### `agent-docs-ui/` — the outer shell (viewer)

- `src/App.jsx` — the viewer: document list, version selection, Canvas mode,
  registry, and the `canvas-request` handlers (api / state / files).
- `public/canvas-inner.html` — the inner shell page loaded in the sandboxed
  iframe (demo shell when no version is selected).
- `src/canvas/csp.js` — `withCanvasShell` (injects bridge + lockdown) and the
  CSP/lockdown scripts.
- `src/canvas/canvasHost.js` — `createCanvasHost`: the chrome-side bridge host.
- `src/canvas/files.js` — chunked file upload/download handler.
- `src/canvas/allowlist.js` — the registry allowlist check.

### `canvas-bridge/` — the bridge

- `docs/canvas-bridge-protocol.md` — the full protocol (1,472 lines).
- `src/canvas/` — the same four modules as above (`csp.js`,
  `canvasHost.js`, `files.js`, `allowlist.js`).
- `public/canvas-inner.html` — same inner shell page.
- `scripts/sync-bridge.mjs` — keeps `canvas-inner.html` in sync with
  `csp.js` (run after any change to the bridge/lockdown scripts).

## Two things to know

1. **The four `src/canvas/` modules and `canvas-inner.html` are
   byte-identical in both repos.** `agent-docs-ui` vendors them from
   `canvas-bridge` (canonical). The duplication here is intentional
   provenance, not divergence — if they ever differ, `canvas-bridge` wins.
2. **`App.jsx` here is ahead of GitHub.** It includes the four E2E fixes
   found 2026-11-11 (version-number bug, src/srcDoc exclusivity, registry
   field normalization, iframe remount key) that are still unpushed on the
   agent-docs-ui `canvas` branch. The rest matches the pushed commits
   (`agent-docs-ui` `canvas` `f34ccc7`, `canvas-bridge` `main` `c1b421b`).

## Excluded on purpose

- `run.js` (QuickJS sandbox) — not used; the sandbox is a standalone
  viewer feature, not part of the shell/bridge.
- Test files (`*.test.mjs`) — the source is what matters for comparison;
  tests live in the real repos.
