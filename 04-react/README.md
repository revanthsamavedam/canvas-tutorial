# Part 04 — The same page, in React

Rebuild the Part 03 sample page in React, and bundle it into one self-contained HTML file.

**You will build:** a Vite + React app (`src/`, `lib/`) that builds to a single `dist/index.html`, loads in the Part 02 viewer, and uses the bridge through the `useCanvas` hook.

**Time:** ~60 minutes. **Prerequisite:** Parts 01–03. You do not need to know React beforehand — the concepts below are the whole of what this part uses.

## Concepts (read this once)

React is a way to describe a page as functions that return HTML, instead of writing the HTML and then editing it by hand.

- **Component** — a JavaScript function that returns what should be on screen. `function Home() { return <main>…</main> }`. Components compose: `App` renders `Home`, `Home` renders `Card`, `Card` renders its children.
- **JSX** — the HTML-like syntax inside the JavaScript: `<Card title="Live docs">…</Card>`. It is not a string and not a template — it compiles to function calls that build DOM elements. Anything in `{braces}` is a JavaScript expression. `className` is JSX for the HTML `class` attribute.
- **Props** — the arguments a component receives: `<Card title="Live docs">` passes `title` as a prop. Inside `Card`, `props.title` (or the destructured `{ title }`) is just a value.
- **State** — a value the component remembers between renders. `const [count, setCount] = useState(0)` gives you the current value and a setter. Calling `setCount(3)` re-renders the component with the new value. State is per-component-instance, like a local variable that survives.
- **Hook** — a function whose name starts with `use` that plugs into React's lifecycle. `useState` (remember a value), `useEffect` (run code after render, e.g. a fetch or a subscription). Rules: hooks run at the top of a component, in the same order every render, never inside an `if` or a loop.
- **Router** — the part that decides which page to show for a URL. This app uses `MemoryRouter` (see Step 3 — the choice matters).
- **Bundle** — the build step. Vite reads your source (many files, imports, JSX, CSS) and produces one output file. `vite-plugin-singlefile` inlines everything — JavaScript and CSS — into a single `dist/index.html`. That is the whole point: a Canvas page is one self-contained file, so the bundle is the publishable artifact.

TypeScript note: this tutorial is plain JavaScript (`.jsx`), not TypeScript, because the real prototype is. The ideas transfer directly — a component is a function, props are its parameters, state is a value you set. If you want types later, rename to `.tsx` and add them; nothing about the bridge changes.

## Step 1 — The component library (`lib/`)

Start here, because it is the smallest piece and it is not React-specific.

`lib/` is a pre-existing component library — in a real deployment, your design system: a workspace package, a git submodule, or an npm package. It has three components:

- `Button({ children, onClick })` — a `<button>` with a class.
- `Card({ title, children })` — a `<section>` with an optional heading. `children` is whatever you put between the tags: `<Card title="X">…</Card>`.
- `Stat({ label, value, icon })` — a number with a label and an icon.

The app imports it by name (`import { Button, Card, Stat } from '@canvas-lib'`), and `vite.config.js` resolves the alias to `./lib` at build time. The library is bundled *into* the single file — it never ships separately and is never loaded from a CDN at view time. That is the rule: everything the page needs must be in the one file.

**Check:** read `lib/Button.jsx` (10 lines). Change the button text in `src/pages/Home.jsx` from "Load live docs" to "Load live docs!" and rebuild (step 5) — the built file should contain the new text. Change it back.

## Step 2 — The hook (`src/useCanvas.js`)

This is the React binding for the bridge, copied from the real prototype. Read it — it is ~90 lines and has two functions:

- **`useCanvas()`** — returns `{ canvas, ready }`. On mount it checks `window.canvas` (already set, in the normal case — the bridge script is a classic script before `</body>` and the app's module script is deferred, so the bridge is there first). If it is not there yet, it polls every 100 ms, up to 20 times, then stops. `ready` is `canvas !== null`. The app renders a fallback while `ready` is false.
- **`useCanvasApi(app, path, opts, deps)`** — returns `{ data, loading, error, ready }`. When `ready` becomes true, it calls the bridge and puts the result in `data`. `data` stays `null` while the bridge is absent, so the caller shows its baked-in fallback.

Two details that look odd and are both load-bearing:

1. **It calls `window.canvas.api.fetch`, not `canvas.api.fetch`.** The minifier renames a local variable (`canvas` becomes `s`), and the publish gate's allowlist matches the literal `canvas.api.fetch` name. Writing the full path is the only way the gate can see the call in the built bundle.
2. **It reads `res.data`, not `res`.** `api.fetch` resolves with `{status, data}` — the API body is in `data`.

**Check:** in `src/pages/Home.jsx`, the "Load live docs" button calls `window.canvas.api.fetch('riskhub', '/v1/docs')` directly (not through `useCanvasApi`) so you can see the call in one place. Trace it: click → `loadLiveDocs` → `res.data.documents` → rendered as "Live docs: 2 — …".

## Step 3 — The router: MemoryRouter, not HashRouter

`src/App.jsx` uses `MemoryRouter`. This is a real bug the prototype hit, so learn it here:

- A srcDoc page's URL is `about:srcdoc`. There is no real URL to put a hash or a path on.
- `HashRouter` reads `window.location` and calls `new URL(...)` against it (react-router's `encodeLocation`). On `about:srcdoc` that throws `Failed to construct 'URL': Invalid URL`, and the app never mounts.
- `MemoryRouter` keeps the history in memory. `Link` navigation still works, the routes are the same (`/` and `/about`), and there is no URL to sync — which is correct, because a srcDoc iframe has no address bar.

**Check:** change `MemoryRouter` to `HashRouter` in `src/App.jsx`, rebuild, load the bundle in the viewer. The iframe stays blank and the console shows the URL error. Change it back. (This is the fastest way to believe the rule.)

## Step 4 — The pages (`src/pages/`)

`Home.jsx` is the Part 03 sample page, rewritten as components. Compare them side by side — the logic is the same, only the shape changed:

| Part 03 (plain HTML) | Part 04 (React) |
|---|---|
| `document.getElementById` + `.textContent` | JSX that reads state: `{ready ? 'Bridge: ready…' : '…'}` |
| `setInterval` poll for the bridge | `useCanvas()` |
| `addEventListener('click')` | `<Button onClick={loadLiveDocs}>` |
| `FALLBACK_DOCS` constant | the same baked-in data, rendered when `ready` is false |
| `state.set('count', …)` | the same call, inside a handler |

`About.jsx` is a second route (`/about`) that proves routing works: a `Link` to it, a `Card` with text.

**Check:** in the viewer, load the React bundle, click **About** in the nav, then **Home**. Both routes render. (With `MemoryRouter`, the URL never changes — the route is in-memory state, and that is fine.)

## Step 5 — Build it

```bash
cd 04-react
npm install
npm run build
```

You should see one file: `dist/index.html`, about 270 KB (~86 KB gzipped). Open it and confirm: exactly one file in `dist/`, one `<style>` tag, zero external `src`/`href`. Then check it against the publish gate's rules:

```bash
npm run check
```

`scripts/check-bundle.mjs` mirrors the real validator: no external resources, no secrets, no direct `fetch(`/`XMLHttpRequest`/`WebSocket` — except the Vite modulepreload helper (dead code, no `<link rel="modulepreload">` exists) and bridge calls (`window.canvas.api.fetch`, allowed by the gate's carve-out). It should report `failures: none`.

**Check:** run `npm run build` and `npm run check`. Both must pass. If `check` reports a direct `fetch(`, the cause is usually a real `fetch(` in app or library code — remove the call; data goes through the bridge.

## Step 6 — Load it in the viewer

```bash
# From the repo root.
python3 -m http.server 8000
# Open http://localhost:8000/02-viewer/viewer.html, click "Load React bundle".
```

You should see the app render, "Bridge: ready — live data available.", and **Load live docs** render "Live docs: 2 — Audit Evidence Pack — Q3, Audit Evidence Pack — Q4". That is the same check the real end-to-end ran.

**Check:** also open `dist/index.html` directly in a browser (double-click). You should see the app with "Bridge: not available — showing demo data." — the fallback path, same as Part 03. The bundle works standalone; the bridge is an upgrade, not a requirement.

## What this does not cover

- **State in this app.** The sample page in Part 03 has a state counter; this React app uses the hook for live data only. Adding `canvas.state` to a React page is the same calls (`window.canvas.state.set/get/subscribe`) inside a `useEffect` — the pattern is in Part 03, step 3.
- **The 5 MB bundle cap.** A proposal, not a rule. The number that matters is your library's bundle size against whatever cap your deployment sets.
- **The esbuild route.** A second prototype built the same app with esbuild instead of Vite. It works, but its inlined lockdown script names `XMLHttpRequest`, which trips the gate's XHR rule. The Vite route has no inlined lockdown (the viewer provides it), so it does not trip. If you ever switch bundlers, run the real validator on the output first.

## Where the real code lives

- `canvas-react-bundle/` prototype — `src/useCanvas.js`, `src/pages/Home.jsx`, `lib/`, `vite.config.js`. This part copies that shape.
- `canvas-react-bundle-guide.md` — the full guide, including the E2E findings (MemoryRouter, the literal bridge call, `{status, data}`, src/srcDoc, versions by number, the registry field names).
