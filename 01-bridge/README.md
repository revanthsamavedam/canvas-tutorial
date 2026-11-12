# Part 01 — The bridge

Build the bridge first, because everything else is just code that uses it.

**You will build:** a page-side client (`bridge.js`, sets `window.canvas`) and a chrome-side host (`host.js`, answers requests). Then you will run them against each other in `demo.html`.

**Time:** ~45 minutes.

## Concepts (read this once)

- **iframe** — an HTML element that embeds another page inside your page. The inner page runs in its own world: its own JavaScript, its own DOM. The viewer embeds the Canvas page in an iframe.
- **sandbox** — an attribute on the iframe that takes away powers. `sandbox="allow-scripts"` means: JavaScript runs, but the iframe gets an *opaque origin* — it cannot read the parent page's cookies, storage, or DOM. There is deliberately no `allow-same-origin`.
- **postMessage** — the browser's way for two windows to send each other plain JavaScript objects: `otherWindow.postMessage(data, '*')`. It is not network. No HTTP request happens, so it works even when the page's network is switched off. Both sides listen with `window.addEventListener('message', ...)`.
- **Promise** — JavaScript's way to say "this value arrives later." `fetch()` returns a Promise; `.then()` runs when it resolves. `async/await` is the same thing written flat: `const res = await window.canvas.api.fetch(...)`.

## Step 1 — The two ends

There are exactly two sides, and they never blur:

- **Outer shell (chrome):** the viewer. Owns the network, the tokens, the registry, the state store. Never hands a token to the page.
- **Inner shell (page):** the published HTML in the sandboxed iframe. Owns pixels, buttons, JavaScript. Knows nothing about tokens or URLs. Can only ask the outer shell, through `window.canvas`.

The only connection is `postMessage`.

**Check:** open `demo.html` in a browser (double-click works — no server needed for this part). You should see the inner page say "Bridge: ready — live data available." and "Live docs: 2 — Audit Evidence Pack — Q3, Audit Evidence Pack — Q4".

## Step 2 — The page-side client (`bridge.js`)

Read `bridge.js` top to bottom. It is ~180 lines and has four moving parts:

1. **The `ready` promise.** The page cannot send a request until the viewer has said hello (the `canvas-init` message, step 4). Requests made before that wait on `ready` — so page code never has to check "is the bridge here yet?" itself.
2. **The `pending` map.** Every request gets a number (`nextId++`). The reply carries the same number, so the client knows which Promise to resolve. This is the same pattern as JSON-RPC, and it is why many requests can be in flight at once.
3. **The message listener.** It ignores any message whose `e.source` is not `window.parent` — only the viewer chrome may talk to the page. Then it switches on `d.type`: `canvas-init` (resolve `ready`), `canvas-response` (resolve/reject the pending Promise), `canvas-download-chunk` (append bytes), `canvas-state-changed` (call subscribers).
4. **`window.canvas` itself.** Four groups: `api` (get/fetch), `state` (get/all/set/delete/subscribe), `files` (upload/download/save). Every method returns a Promise. `api.fetch` resolves with `{status, data}` — the API's JSON body is in `data`, not at the top level.

Note what the client does *not* do: it never calls `fetch`, never holds a token, never knows an API URL. It only knows names (`'riskhub'`) and paths (`'/v1/docs'`).

**Check:** in `demo-page.html`, change the path to `'/v1/nope'` and reload. You should see the page report the error instead of data. Change it back.

## Step 3 — The chrome-side host (`host.js`)

Read `host.js`. `createBridgeHost(options)` returns `{startSession, handleMessage}`. The viewer supplies the pieces the host needs: `getFrame`, the registry (`apis`), `callRegisteredApi`, `canvasApiGet`, the `state` store, and the file functions. The host is the switchboard — it never invents data.

For every message, in order:

1. **Source check** — `e.source` must be the iframe's `contentWindow`. Anything else is ignored.
2. **Session check** — `d.session` must equal the current nonce, or the reply is `STALE_SESSION`. A request from an old view can never act on the current one.
3. **Dispatch on `kind`** — `api`, `api:fetch`, `state:get/all/set/delete`, `files:upload:start/chunk/finish`, `files:download`. Unknown kinds throw.
4. **Reply** — `{type: 'canvas-response', id, ok, value}`. Downloads are the exception: they resolve via `canvas-download-chunk` messages, not a single response, because the bytes arrive in 1 MB pieces.

**Check:** in `demo.html`, change the registry name from `'riskhub'` to `'other'`, reload, and watch the inner page fail with `api_not_registered`. The chrome log shows the same error. Change it back.

## Step 4 — The handshake (canvas-init)

The viewer issues a fresh session nonce every time the iframe loads:

```js
frame.addEventListener('load', function () { host.startSession('demo-doc') })
```

`startSession` generates a random nonce (`crypto.randomUUID()`), stores it, and posts `{type: 'canvas-init', docId, session}` into the iframe. The page stores it and resolves `ready`. Every request after that echoes the nonce.

Why a nonce at all? Without it, a page from an old view (say, the previous document the viewer showed) could keep sending requests after the viewer moved on. The nonce makes each view's requests valid only for that view.

**Check:** open the browser console on `demo.html` and run `document.querySelector('iframe').contentWindow.postMessage({type:'canvas-request', id: 999, kind: 'state:all', session: 'wrong'}, '*')`. Nothing happens — the message is ignored (wrong source *and* wrong session). This is the check the host does for you.

## Step 5 — The request kinds

| Kind | Page calls it as | Chrome does |
|---|---|---|
| `api` | `canvas.api.get(path)` | GET against the Canvas API itself, allowlisted paths only |
| `api:fetch` | `canvas.api.fetch(app, path, opts)` | Registry lookup → token fetch → API call → `{status, data}` |
| `state:get` / `state:all` | `canvas.state.get(key)` / `.all()` | Read the document-scoped KV store |
| `state:set` / `state:delete` | `canvas.state.set(key, v)` / `.delete(key)` | Write, then broadcast `canvas-state-changed` |
| `files:upload:start/chunk/finish` | `canvas.files.upload({api, path, file})` | Reassemble 1 MB chunks, POST multipart to the API |
| `files:download` | `canvas.files.download({api, path})` | Fetch binary from the API, stream back in chunks |

Files are the only chunked kind. A file is too big for one `postMessage`, so the client slices it into 1 MB pieces (`file.slice`), sends each piece with its index, and the host reassembles them in order before POSTing. Downloads go the other way: the host slices the bytes and the client reassembles them into a `Blob`.

**Check:** in `demo-page.html`, add a download call after the state read and log the blob size:

```js
window.canvas.files.download({ api: 'riskhub', path: '/v1/docs' })
  .then(function (blob) { console.log('downloaded', blob.size, 'bytes') })
```

You should see `downloaded … bytes` in the console (the stub returns the docs as JSON).

## Step 6 — What the stub stands in for

`demo.html` answers bridge calls with in-page functions. In the real viewer:

- `callRegisteredApi` POSTs to the registry entry's `token_url`, reads `access_token`, then calls the entry's `base_url + path` with `Authorization: Bearer <token>`. The page sees the same `{status, data}` shape.
- `state` is a document-scoped key-value store in Postgres (`document_state`), not an in-memory object.
- `canvasApiGet` checks the path against a fixed allowlist before fetching anything.

The page-side protocol — the message types, the kinds, the `{status, data}` shape — is identical. That is the point of this part: learn the protocol here, and the real chrome is the same conversation with real network behind it.

## Where the real code lives

- `canvas-bridge/docs/canvas-bridge-protocol.md` §5–§7 — the full contract (message shapes, error codes, the file protocol in detail).
- `canvas-bridge/src/canvas/csp.js` — `CANVAS_BRIDGE_SCRIPT`, the exact client the viewer injects.
- `canvas-bridge/src/canvas/canvasHost.js` — `createCanvasHost`, the real host.
- `agent-docs-ui/src/App.jsx` — the `canvas-request` handler (the real dispatch) and `callRegisteredApi` (the real token flow).
