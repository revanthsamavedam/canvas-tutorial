# Canvas tutorial

Learn how the Canvas bridge, viewer, and sample pages work — by building each piece yourself, in order.

![Canvas architecture](docs/architecture.png)

The diagram is also editable: `docs/architecture.excalidraw` opens at excalidraw.com. `docs/architecture.svg` is the same diagram as a vector file; `docs/architecture.png` is rendered from it (`node scripts/verify.mjs` re-renders it). `scripts/gen-diagram.mjs` generates both from one layout, so they can't drift apart.

## The mental model (one paragraph)

Canvas publishes agent-built web pages. A page is one self-contained HTML file, locked in a sandboxed iframe with **no network at all** (CSP `connect-src 'none'` + a lockdown script that replaces `fetch` with a throwing stub). The only way out is a narrow bridge: the page talks to the viewer (the **outer shell**) over `postMessage`, the viewer decides whether the ask is allowed, does the network call itself with its own tokens, and hands back only the result. The page never holds a token and never fetches directly. The viewer side is the **outer shell** (owns network, tokens, registry, state). The page side is the **inner shell** (owns pixels, buttons, JavaScript). The bridge between them is `window.canvas`.

## Roadmap

| Part | What you build | Time |
|---|---|---|
| [01-bridge](01-bridge/) | The bridge itself: page-side client + chrome-side host, over `postMessage` | ~45 min |
| [02-viewer](02-viewer/) | The viewer: outer shell, inner shell (CSP + lockdown + injection), srcDoc iframe, request handlers | ~45 min |
| [03-sample-html](03-sample-html/) | A plain HTML/JS page that uses the bridge, with a baked-in fallback when the bridge is absent | ~30 min |
| [04-react](04-react/) | The same thing in React: Vite bundles it to one HTML file, MemoryRouter, the `useCanvas` hook, a small component library | ~60 min |

Total: about 3 hours, in four sittings. Each part ends with a concrete check ("you should see X"). Do the parts in order — each one uses the previous one.

## How to run it

```bash
# From the repo root. ES modules and fetch() need HTTP, not file://.
python3 -m http.server 8000
# Then open http://localhost:8000/02-viewer/viewer.html
```

Node 20+ also works for the React part (`cd 04-react && npm install && npm run build`).

## Where this came from

This is a teaching repo, not the production platform. The real code lives in:

- **Bridge protocol + implementation** — `canvas-bridge` repo (`docs/canvas-bridge-protocol.md`, `src/canvas/`). The tutorial's `bridge.js` and `host.js` are minimal versions of `CANVAS_BRIDGE_SCRIPT` and `createCanvasHost`.
- **Viewer chrome** — `agent-docs-ui` repo (`src/canvas/csp.js`, `src/canvas/canvasHost.js`, `src/App.jsx` Canvas mode). The tutorial's `shell.js` is a minimal `withCanvasShell`.
- **React bundle + hook** — the `canvas-react-bundle` prototype (`src/useCanvas.js`, `src/pages/Home.jsx`, `lib/`). Part 04 copies that shape.

What this repo deliberately leaves out: the publish API, the registry database, the publish gate, and auth. The viewer here answers bridge calls with an in-page stub API ("riskhub") instead of real HTTP + tokens. The page-side protocol is identical to the real one, so the sample pages work unchanged in the real viewer — the only difference is on the chrome side, where the real viewer POSTs to a token URL and calls a real API base URL, and this tutorial calls an in-page stub function instead. Each part's README says exactly where the stub stands in for the real thing.

## The rules that matter most

These are the things the real build got wrong first, so you don't have to:

1. **The page never fetches directly.** CSP `connect-src 'none'` blocks it at the browser level; the lockdown script makes it throw a clear error.
2. **The page never holds a token.** Only the outer shell fetches tokens and sets `Authorization`.
3. **Call the bridge via the literal `window.canvas.api.fetch(...)`.** A destructured variable (`const { canvas } = ...`) gets renamed by the minifier, and the publish gate's allowlist can't see it.
4. **Use MemoryRouter, not HashRouter, in React.** A srcDoc page's URL is `about:srcdoc`; HashRouter's `encodeLocation` does `new URL(...)` against it and throws.
5. **`api.fetch` resolves with `{status, data}`.** The API's JSON body is in `data`, not at the top level.
6. **An iframe's `src` and `srcDoc` are mutually exclusive.** If both are set, React updating `srcDoc` on an iframe that already loaded via `src` does not reliably navigate it. Set `src` only when no version is loaded.
7. **Versions are identified by number, not id.** The API returns `number`; there is no version `id`.
8. **Registry entries are `{app_name, base_url}`; the chrome reads `{name, api_url}`.** Normalize at the load site.

## Verify it

```bash
node scripts/verify.mjs
```

Runs the viewer + sample page + React bundle in headless Chromium and reports pass/fail per step. See [scripts/verify.mjs](scripts/verify.mjs).
