# Part 03 — A sample page in plain HTML

Build a Canvas page with no framework: just HTML and JavaScript.

**You will build:** `index.html` — a page that checks for the bridge, loads live data through it, reads/writes shared state, downloads a file, and falls back to baked-in data when the bridge is absent.

**Time:** ~30 minutes. **Prerequisite:** Parts 01–02 (at least read them; this page runs in the viewer from Part 02).

## Concepts (read this once)

- **DOM** — the browser's in-memory model of the page. `document.getElementById('x')` finds an element; setting `.textContent` changes what it shows; `.addEventListener('click', ...)` runs code when it is clicked. Every web page is a DOM plus JavaScript that edits it.
- **Fallback data** — data baked into the page at build time. A Canvas page always renders something. Live data through the bridge is an upgrade, not a requirement: if the bridge is absent (page opened standalone, API unregistered, call failed), the page shows the baked-in data and says so.

## Step 1 — Check for the bridge

The bridge is injected by the viewer at view time. It may not exist when your script runs, and it never exists outside the viewer. So the page polls briefly (`setInterval`, 100 ms, up to 20 tries) and then settles: `onBridgeReady` or `onBridgeAbsent`.

```js
if (bridgeReady()) { /* use it */ } else { /* show fallback */ }
```

This is the same graceful-fallback pattern the React hook uses in Part 04. The page never crashes on an undefined bridge — it renders the fallback and says the bridge is absent.

**Check:** open `index.html` directly in a browser (double-click, no viewer). You should see "Bridge: not available — showing demo data." and the baked-in docs. The buttons stay disabled — there is nothing for them to call.

## Step 2 — Load live data

```js
window.canvas.api.fetch('riskhub', '/v1/docs')
  .then(function (res) {
    var docs = res.data.documents
    // render docs…
  })
```

Three things to notice:

1. **The literal `window.canvas.api.fetch(...)`.** Write the full path every time. If you save the bridge to a variable (`const c = window.canvas`) and call `c.api.fetch`, a minifier renames the variable and the publish gate's allowlist cannot recognise the call. This page is not minified, but the rule is the same everywhere — write it out.
2. **`res.data`, not `res`.** `api.fetch` resolves with `{status, data}`. The API's JSON body is in `data`. Reading `res.documents` gives `undefined`.
3. **The page names an API, not a URL.** `'riskhub'` is a registry name. The viewer resolves it, fetches the token, and calls the real URL. The page never sees either.

**Check:** open the viewer (`02-viewer/viewer.html`), click **Load sample HTML page**, then click **Load live docs**. You should see "Live docs: 2 — Audit Evidence Pack — Q3, Audit Evidence Pack — Q4". The viewer's sidebar log shows the `api:fetch` call.

## Step 3 — Shared state

```js
window.canvas.state.set('count', next)
window.canvas.state.get('count')          // read it back
window.canvas.state.subscribe('count', function (v) { /* v changed */ })
```

State is a key-value store scoped to the *document*, not the page. It survives page reloads and version changes in the real viewer (it lives in the chrome's store, not in the page). `subscribe` pushes changes: if another view of the same document changes `count`, this page updates without reloading.

**Check:** in the viewer, click **+1** three times. The count shows 3. Reload the viewer page and load the sample again — the count is still 3 (the state lives in the viewer's store; in this tutorial it is in-memory, so it resets only when the viewer page itself reloads).

## Step 4 — Files

```js
window.canvas.files.save({ api: 'riskhub', path: '/v1/docs', filename: 'docs.json' })
```

`files.save` downloads the file through the bridge and triggers a browser download. The page never sees the bytes' URL or a token. (`files.download` returns a `Blob` instead, if you want the bytes in code.)

**Check:** click **Download docs.json**. Your browser should download a JSON file containing the two docs.

## Step 5 — What not to do

- **Do not call `fetch()` in the page.** The CSP blocks it at the browser level and the lockdown script makes it throw. If you need data, it goes through the bridge.
- **Do not put a token, an API URL, or a password in the page.** There is nowhere safe to put one — the page is readable by anyone who opens it.
- **Do not submit a `<form>` natively.** `form-action 'none'` blocks it. Use a button click + a bridge call instead (a form is just a button that gathers fields first).
- **Do not assume the bridge exists.** Always have a fallback path. A page that crashes without the bridge is a page that cannot be previewed standalone.

## Where the real code lives

- `canvas-bridge/docs/canvas-bridge-protocol.md` §6, §10 — the full `window.canvas` API and the forms rule.
- `agent-docs-ui/public/canvas-inner.html` — the real demo shell, a plain-HTML page that exercises the same calls this sample does.
