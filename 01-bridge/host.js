"use strict";
// host.js — the chrome-side bridge host.
//
// The other half of bridge.js. The viewer creates one host per
// iframe and wires it to window 'message' events. It is the only
// code in the system that touches the network and tokens — the page
// never does.
//
// What it does, in order, for every message:
//   1. Checks the message came from the iframe (e.source must be the
//      iframe's contentWindow). A message from anywhere else is
//      ignored — this is the chrome's version of the page's
//      "only window.parent may talk to me" check.
//   2. Checks the session nonce. The viewer issues a fresh nonce per
//      view (startSession) and the page echoes it on every request.
//      A stale or missing session is rejected with STALE_SESSION, so
//      a request from an old view (an old document) can never act on
//      the current one.
//   3. Dispatches on `kind` and replies with {type:
//      'canvas-response', id, ok, value} — or ok:false with an error
//      string. The page's pending map matches the id and resolves or
//      rejects the Promise.
//
// The host never invents data: api calls go to callRegisteredApi (the
// viewer supplies it — in this tutorial a stub, in production the
// real registry + token fetch), state goes to the state store, files
// go through the upload/download handlers. The host is the switchboard.
//
// Types (this file is TypeScript; the logic is identical to the
// plain-JavaScript host.js on main). The host never invents data, so
// the option types below are the whole of what the viewer supplies.
(function () {
    var CHUNK = 1024 * 1024; // 1 MB, must match bridge.js
    function newSession() {
        if (window.crypto && window.crypto.randomUUID)
            return window.crypto.randomUUID();
        return 's_' + Date.now().toString(36) + '_' + Math.floor(Math.random() * 1e9).toString(36);
    }
    // options:
    //   getFrame()          -> the iframe element (or null)
    //   apis                -> [{name, api_url, token_url}] (already normalized)
    //   callRegisteredApi(api, path, {method, body}) -> Promise<{status, data}>
    //   canvasApiGet(path)  -> Promise<value> (the Canvas API itself, allowlisted)
    //   state               -> {get(key), all(), set(key, value), delete(key)}
    //   uploadToApi(api, path, {filename, type, field, bytes}) -> Promise<{status, data}>
    //   downloadFromApi(api, path, params) -> Promise<{bytes, contentType, filename}>
    //   onStateChanged(key, value) -> called after a state write (chrome broadcasts + refreshes UI)
    //   onLog({label, status, ms}) -> optional, for the viewer's network log
    function createBridgeHost(options) {
        var session = null;
        var uploads = {}; // uploadId -> {api, path, field, filename, size, type, chunks: [], received}
        var log = options.onLog || function () { };
        function frame() {
            return typeof options.getFrame === 'function' ? options.getFrame() : null;
        }
        function startSession(docId) {
            session = newSession();
            var f = frame();
            if (f && f.contentWindow) {
                f.contentWindow.postMessage({ type: 'canvas-init', docId: docId || null, session: session }, '*');
            }
            uploads = {};
            return session;
        }
        function reply(id, ok, value, error) {
            var f = frame();
            if (!f || !f.contentWindow)
                return;
            f.contentWindow.postMessage({ type: 'canvas-response', id: id, ok: ok, value: value, error: error }, '*');
        }
        function broadcastState(key, value) {
            var f = frame();
            if (!f || !f.contentWindow)
                return;
            f.contentWindow.postMessage({ type: 'canvas-state-changed', key: key, value: value }, '*');
            if (typeof options.onStateChanged === 'function')
                options.onStateChanged(key, value);
        }
        function isAppRegistered(name) {
            return (options.apis || []).some(function (a) { return a.name === name; });
        }
        async function handleMessage(e) {
            var f = frame();
            if (!f || e.source !== f.contentWindow)
                return;
            var d = e.data || {};
            if (d.type !== 'canvas-request' || !d.id)
                return;
            var started = Date.now();
            try {
                if (!d.session || d.session !== session) {
                    reply(d.id, false, undefined, 'STALE_SESSION');
                    return;
                }
                var value;
                if (d.kind === 'api') {
                    value = await options.canvasApiGet(d.path);
                }
                else if (d.kind === 'api:fetch') {
                    if (!isAppRegistered(d.api))
                        throw new Error('api_not_registered');
                    value = await options.callRegisteredApi(d.api, d.path, { method: d.method || 'GET', body: d.body === undefined ? null : d.body });
                }
                else if (d.kind === 'state:get') {
                    value = await options.state.get(d.key);
                }
                else if (d.kind === 'state:all') {
                    value = await options.state.all();
                }
                else if (d.kind === 'state:set') {
                    value = await options.state.set(d.key, d.value);
                    broadcastState(d.key, d.value);
                }
                else if (d.kind === 'state:delete') {
                    await options.state.delete(d.key);
                    broadcastState(d.key, null);
                    value = null;
                }
                else if (d.kind === 'files:upload:start') {
                    if (!isAppRegistered(d.api))
                        throw new Error('api_not_registered');
                    var chunks = Math.ceil(d.size / CHUNK);
                    uploads[d.uploadId] = { api: d.api, path: d.path, field: d.field, filename: d.filename, size: d.size, type: d.type, chunks: chunks, received: [] };
                    value = { chunkSize: CHUNK, chunks: chunks };
                }
                else if (d.kind === 'files:upload:chunk') {
                    var up = uploads[d.uploadId];
                    if (!up)
                        throw new Error('unknown_upload');
                    // The data arrives as an ArrayBuffer (transferred, zero-copy).
                    up.received[d.index] = d.data;
                    value = { received: d.index };
                }
                else if (d.kind === 'files:upload:finish') {
                    var up2 = uploads[d.uploadId];
                    if (!up2)
                        throw new Error('unknown_upload');
                    delete uploads[d.uploadId];
                    var bytes = concatBuffers(up2.received);
                    value = await options.uploadToApi(up2.api, up2.path, { filename: up2.filename, type: up2.type, field: up2.field, bytes: bytes });
                }
                else if (d.kind === 'files:download') {
                    if (!isAppRegistered(d.api))
                        throw new Error('api_not_registered');
                    var dl = await options.downloadFromApi(d.api, d.path, d.params || null);
                    sendDownload(d.id, dl);
                    log({ label: 'files:download ' + d.api + ' ' + d.path, status: 'ok', ms: Date.now() - started });
                    return; // downloads resolve via canvas-download-chunk, not canvas-response
                }
                else {
                    throw new Error('unknown_kind: ' + d.kind);
                }
                log({ label: d.kind, status: 'ok', ms: Date.now() - started });
                reply(d.id, true, value);
            }
            catch (err) {
                log({ label: d.kind, status: 'error', ms: Date.now() - started });
                reply(d.id, false, undefined, String(err && err.message ? err.message : err));
            }
        }
        function concatBuffers(parts) {
            var total = 0;
            parts.forEach(function (p) { if (p)
                total += p.byteLength; });
            var out = new Uint8Array(total);
            var at = 0;
            parts.forEach(function (p) {
                if (!p)
                    return;
                out.set(new Uint8Array(p), at);
                at += p.byteLength;
            });
            return out.buffer;
        }
        function sendDownload(id, dl) {
            var f = frame();
            if (!f || !f.contentWindow)
                return;
            var bytes = dl.bytes instanceof ArrayBuffer ? new Uint8Array(dl.bytes) : dl.bytes;
            var total = bytes.byteLength;
            var chunks = Math.max(1, Math.ceil(total / CHUNK));
            for (var i = 0; i < chunks; i++) {
                var slice = bytes.slice(i * CHUNK, Math.min((i + 1) * CHUNK, total));
                var done = i === chunks - 1;
                var msg = {
                    type: 'canvas-download-chunk',
                    id: id,
                    data: slice.buffer.slice(slice.byteOffset, slice.byteOffset + slice.byteLength),
                };
                if (i === 0)
                    msg.meta = { contentType: dl.contentType || 'application/octet-stream', filename: dl.filename || 'download' };
                if (done)
                    msg.done = true;
                f.contentWindow.postMessage(msg, '*', [msg.data]);
            }
        }
        return { startSession: startSession, handleMessage: handleMessage };
    }
    window.createBridgeHost = createBridgeHost;
})();
