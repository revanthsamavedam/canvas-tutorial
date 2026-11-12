# How to test each stage

This is the TypeScript branch: same tutorial, same checks as `master`, plus
a typecheck step. Run the stages in order — each one builds on the last.
"Pass" means the exact text or exit code listed, not "it looked fine."

## 0. Before you start (all stages)

```bash
# From the repo root. Installs TypeScript for the root build.
npm install
# Compile the Part 01–02 sources. The compiled .js files are checked in,
# so the tutorial runs with no build step — but after editing any .ts file,
# rebuild before testing, or you will be testing the stale .js.
npm run build
```

Expected: `tsc` exits 0 with no errors. It emits `01-bridge/bridge.js`,
`01-bridge/host.js`, and `02-viewer/shell.js` next to their `.ts` sources.

## Stage 01 — The bridge

No server needed for this stage.

```bash
# Open 01-bridge/demo.html in a browser (double-click works).
```

Expected: the inner page says "Bridge: ready — live data available." and
"Live docs: 2 — Audit Evidence Pack — Q3, Audit Evidence Pack — Q4".

Three negative checks (each one proves a guard works — change it back after):

1. In `01-bridge/demo-page.html`, change the path to `'/v1/nope'` and reload.
   Expected: the page reports the error instead of data.
2. In `01-bridge/demo.html`, change the registry name from `'riskhub'` to
   `'other'` and reload. Expected: the inner page fails with
   `api_not_registered`, and the chrome log shows the same error.
3. In the browser console on `demo.html`, run:
   `document.querySelector('iframe').contentWindow.postMessage({type:'canvas-request', id: 999, kind: 'state:all', session: 'wrong'}, '*')`
   Expected: nothing happens — the message is ignored (wrong source *and*
   wrong session).

File check: in `demo-page.html`, add a download call after the state read
and log the blob size (see Part 01 README, step 5). Expected: the console
shows `downloaded … bytes`.

## Stage 02 — The viewer

```bash
# From the repo root. ES modules and fetch() need HTTP, not file://.
python3 -m http.server 8000
# Open http://localhost:8000/02-viewer/viewer.html
```

Click **Load sample HTML page**. Expected: the sample page renders inside
the viewer with "Bridge: ready", and the sidebar log shows the `api:fetch`
call as a line (`api:fetch — ok (3ms)`).

Three checks:

1. **Lockdown.** In the browser console, use the context selector to pick
   the iframe, then run `fetch('/v1/docs')`. Expected: the lockdown error
   ("fetch is blocked"), not data.
2. **src/srcDoc.** After loading the sample page, run
   `document.querySelector('iframe').hasAttribute('src')` in the console.
   Expected: `false`. Reload the viewer and check again before loading a
   page — the iframe has `src="demo-shell.html"` and shows "No page loaded."
3. **Session.** Load the sample page, note the log, then load the React
   bundle (stage 04). Expected: the log shows a new session's requests.

## Stage 03 — The sample page

Standalone first (no viewer, no bridge):

```bash
# Open 03-sample-html/index.html directly in a browser (double-click).
```

Expected: "Bridge: not available — showing demo data." and the baked-in
docs. The buttons stay disabled.

Then in the viewer (server from stage 02 still running):

```bash
# Open http://localhost:8000/02-viewer/viewer.html, click "Load sample HTML page".
```

Expected, in order:

1. Click **Load live docs**. Expected: "Live docs: 2 — Audit Evidence Pack
   — Q3, Audit Evidence Pack — Q4". The viewer sidebar log shows the
   `api:fetch` call.
2. Click **+1** three times. Expected: the count shows 3. Reload the viewer
   page and load the sample again — the count is still 3 (state lives in
   the viewer's store; it resets only when the viewer page itself reloads).
3. Click **Download docs.json**. Expected: the browser downloads a JSON file
   containing the two docs.

## Stage 04 — React

```bash
cd 04-react
npm install
npm run typecheck   # TypeScript only — no equivalent on master
npm run build
npm run check
```

Expected, in order:

1. `typecheck` (`tsc --noEmit`) exits 0.
2. `build` (`vite build`) exits 0 and produces exactly one file,
   `dist/index.html`, about 271 KB (~86 KB gzipped), with one `<style>` tag
   and zero external `src`/`href`.
3. `check` (`node scripts/check-bundle.mjs`) reports `failures: none`.

Then load it in the viewer (server from stage 02 still running):

```bash
# Open http://localhost:8000/02-viewer/viewer.html, click "Load React bundle".
```

Expected: the app renders, "Bridge: ready — live data available.", and
**Load live docs** renders "Live docs: 2 — Audit Evidence Pack — Q3, Audit
Evidence Pack — Q4". Click **About** in the nav, then **Home** — both routes
render (the URL never changes; the route is in-memory state).

Standalone: open `04-react/dist/index.html` directly (double-click).
Expected: the app renders with "Bridge: not available — showing demo data."
— the fallback path, same as stage 03.

Negative check (proves the router rule): change `MemoryRouter` to
`HashRouter` in `src/App.tsx`, rebuild, load the bundle in the viewer.
Expected: the iframe stays blank and the console shows the URL error.
Change it back.

## Full verification (all stages at once)

```bash
# From the repo root. Serves the repo and drives headless Chromium
# through the real viewer, sample page, and React bundle.
node scripts/verify.mjs
```

Expected: 7/7 steps `PASS` and the final line
`RESULT: all steps passed`, exit code 0. Any `FAIL` names the stage that
broke — go back to that stage's checks above.
