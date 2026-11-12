# Part 02 — The viewer

Build the viewer: the outer shell that shows a page, and the inner shell that locks it down.

**You will build:** `shell.js` (CSP + lockdown + injection), `viewer.html` (outer shell, iframe, request handlers, stub registry), and `demo-shell.html` (what shows when no page is loaded). It reuses `host.js` from Part 01.

**Time:** ~45 minutes. **Prerequisite:** Part 01.

## Concepts (read this once)

- **CSP (Content Security Policy)** — a header (or `<meta>` tag) that tells the browser what a page may do. `connect-src 'none'` means "this page may open no network connections." The browser enforces it; JavaScript cannot undo it. CSP is the lock. The lockdown script is just the error message.
- **srcDoc** — an iframe attribute that sets the iframe's content from a string of HTML, instead of loading a URL. `iframe.srcdoc = '<html>…'` renders that HTML. The page's URL becomes `about:srcdoc`.
- **Render copy** — the viewer never serves the stored page as-is. It makes a copy, injects the CSP meta + lockdown + bridge into the copy, and renders that. The stored version stays byte-identical.

## Step 1 — The inner shell (`shell.js`)

Read `shell.js`. `withCanvasShell(html, bridgeSource)` does three injections, in this order:

1. **CSP meta + lockdown into `<head>`** — before any page code runs.
2. **Bridge client just before `</body>`** — after the page's own scripts. (A React app's module script is deferred, so it runs after the bridge anyway; `window.canvas` exists when the app mounts.) The bridge goes before the **last** `</body>`, not the first: a page's own script can contain the literal string `</body>` (the sample page has it in a comment), and a first-match replace injects the bridge in the middle of that script — the injected `</script>` closes the page's `<script>` early and the rest of the page's code renders as visible text. This repo's sample page is the regression test for that: it broke exactly this way while the tutorial was being built, and `lastIndexOf` fixed it. The real `agent-docs-ui` `withCanvasShell` still uses first-match — same latent bug.

The CSP string is the same as the real one. Read it as refusals: `default-src 'none'` (nothing allowed unless another rule says so), `script-src 'unsafe-inline'` (inline scripts only — no CDN libraries), `img-src data:` (images only embedded as data URLs), `connect-src 'none'` (**no network**), `form-action 'none'` (no native form submit — use a button + the bridge).

The lockdown script replaces `fetch`, `XMLHttpRequest`, `WebSocket`, `EventSource`, `Worker`, and `window.open` with functions that throw a readable error ("Canvas inner shell: fetch is blocked. Use window.canvas.* via the outer shell."). It locks them with `Object.defineProperty(..., {writable: false, configurable: false})` so page code cannot restore the originals. It also blocks creating `<iframe>`, `<object>`, `<embed>` — a nested frame would be a fresh realm with fresh globals, a way around the locks.

**Check:** open `viewer.html` (see "How to run" below) and load the sample page. Then, in the page, try `fetch('/v1/docs')` from the browser console *inside the iframe* (use the console's context selector to pick the iframe). You should get the lockdown error, not data.

## Step 2 — The outer shell (`viewer.html`)

Read `viewer.html`. It has four jobs:

1. **Load a page** — fetch its HTML (or read a file the user picked), wrap it with `withCanvasShell`, set it as the iframe's `srcDoc`.
2. **Issue the session** — on iframe load, `host.startSession(docId)` posts `canvas-init` with a fresh nonce.
3. **Answer requests** — `window.addEventListener('message', e => host.handleMessage(e))` hands every message to the host from Part 01.
4. **Show the chrome state** — the registry, the document state (KV), and a log, in the sidebar.

The stub registry has one entry, `riskhub`. The stub `callRegisteredApi` "fetches a token" (in-page) and "calls the API" (in-page). In the real viewer, those two steps are a POST to the token URL and a call to the base URL with `Authorization: Bearer <token>`. The page sees the same `{status, data}` shape either way — that is the contract the stub preserves. In the real platform the token exchange is server-side and the client credentials (client ID / client secret) for an API live as optional Vault references on the registry entry — never the secret itself, and never in the browser. APIs without client credentials (like riskhub today) keep working unchanged.

**Check:** load the sample page, open the browser console, and watch the chrome log in the sidebar. Each bridge call appears as a line (`api:fetch — ok (3ms)`).

## Step 3 — src and srcDoc are mutually exclusive

This is the bug the real build hit, so learn it here instead of in production.

An iframe can have a `src` (load a URL) or a `srcDoc` (render a string) — not both at once. The real viewer first wrote both:

```html
<iframe src="/canvas-inner.html" srcDoc={canvasDocSrc} />
```

React updating `srcDoc` on an iframe that already loaded via `src` does **not** reliably navigate it to the srcDoc content — the iframe kept showing the demo shell. The same race exists in plain JS: `removeAttribute('src')` starts an about:blank navigation, and setting `srcdoc` in the same task sometimes loses to it — the frame stays on about:blank and the page never loads (seen 1 run in 3 while this tutorial was being built). The fix is to make them mutually exclusive **and** split the two steps across the blank page's load event:

```js
// loadPage: if the iframe still has a src, park the shelled HTML and
// remove src. The blank page's load event then sets srcdoc.
var pendingSrcdoc = null
frame.addEventListener('load', function () {
  if (pendingSrcdoc !== null) {
    var s = pendingSrcdoc
    pendingSrcdoc = null
    frame.srcdoc = s
    return
  }
  if (currentDoc) host.startSession(currentDoc)
})
function loadPage(html, docId) {
  currentDoc = docId
  var shelled = CanvasShell.withCanvasShell(html, bridgeSource)
  if (frame.hasAttribute('src')) {
    pendingSrcdoc = shelled
    frame.removeAttribute('src')
  } else {
    frame.srcdoc = shelled // no src left: set srcdoc directly
  }
}
// Nothing loaded: only src, no srcDoc.
frame.src = 'demo-shell.html'
```

`viewer.html` does exactly this in `loadPage`. When a page is loaded, `frame.src` is removed; when nothing is loaded, the demo shell loads via `src`.

**Check:** load the sample page, then in the console run `document.querySelector('iframe').hasAttribute('src')`. It should be `false`. Click nothing else, reload the viewer, and check again before loading a page — the iframe has `src="demo-shell.html"` and shows "No page loaded."

## Step 4 — The session, again

Every iframe load gets a fresh nonce (`startSession` on the iframe's `load` event). The old nonce stops working immediately, and any partial file upload from the old view is dropped. This is why the viewer re-issues the session on every load, not just once.

**Check:** load the sample page, note the log, then load the React bundle. The log shows a new session's requests; the sample page's old session cannot make requests any more (its iframe is gone, but the point stands — the host only honours the current nonce).

## How to run

```bash
# From the repo root. ES modules and fetch() need HTTP, not file://.
python3 -m http.server 8000
# Open http://localhost:8000/02-viewer/viewer.html
```

Click **Load sample HTML page**. You should see the sample page inside the viewer, with "Bridge: ready" and a working "Load live docs" button. The sidebar shows the registry (`riskhub`), the state store (updates when the page writes state), and the log.

If you see "could not load bridge.js", you opened the file with `file://` instead of the HTTP server. `fetch()` cannot read local files from a `file://` page — that is a browser rule, not a bug in the viewer.

## Where the real code lives

- `agent-docs-ui/src/canvas/csp.js` — the real `CANVAS_CSP`, `LOCKDOWN_SCRIPT`, `withCanvasShell`.
- `agent-docs-ui/src/App.jsx` — Canvas mode: the iframe (src/srcDoc mutually exclusive), the `canvas-init` on load, the `canvas-request` handler, `callRegisteredApi` (the real token flow).
- `canvas-bridge/docs/canvas-bridge-protocol.md` §4–§5 — the two locks and the injection order, in full.
