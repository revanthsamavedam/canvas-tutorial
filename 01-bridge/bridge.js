// bridge.js — the page-side Canvas bridge client.
//
// This is a minimal version of CANVAS_BRIDGE_SCRIPT (the real one is
// injected by the viewer at view time — see 02-viewer/shell.js). Drop
// it into any page with a classic <script src="bridge.js"> and the
// page gets window.canvas. No imports, no config.
//
// How it works (three ideas):
//   1. postMessage — the page and the viewer are different windows.
//      window.parent.postMessage sends a plain object to the viewer;
//      the viewer replies with another postMessage. The browser's
//      network stack is never involved, which is why this works even
//      though the page has no network at all.
//   2. Request/response by id — every request gets a number. The
//      reply carries the same number, so the client knows which
//      Promise to resolve. (This is the same pattern as JSON-RPC.)
//   3. Session nonce — the viewer sends a random session id in a
//      canvas-init message when the page loads. Every request echoes
//      it. Requests made before init arrives wait for it (the `ready`
//      promise), so page code never has to wait for the bridge itself.
//
// The page never sees a token. api.fetch goes to the viewer, the
// viewer fetches the token and calls the API, and only {status, data}
// comes back.
(function () {
  var pending = {} // id -> {resolve, reject}
  var subs = {} // state key -> [callback]
  var downloads = {} // id -> {chunks, meta, resolve, reject}
  var nextId = 1
  var docId = null
  var session = null
  var readyResolve = null
  var ready = new Promise(function (res) { readyResolve = res })
  var CHUNK = 1024 * 1024 // 1 MB file chunks over postMessage

  function notInViewer() {
    return Promise.reject(new Error('canvas bridge: not running inside the Canvas viewer'))
  }

  function request(kind, extra) {
    if (window.parent === window) return notInViewer()
    return ready.then(function () {
      return new Promise(function (resolve, reject) {
        var id = nextId++
        pending[id] = { resolve: resolve, reject: reject }
        window.parent.postMessage(Object.assign({ type: 'canvas-request', id: id, kind: kind, session: session }, extra), '*')
      })
    })
  }

  function requestChunk(kind, extra, buffer) {
    if (window.parent === window) return notInViewer()
    return ready.then(function () {
      return new Promise(function (resolve, reject) {
        var id = nextId++
        pending[id] = { resolve: resolve, reject: reject }
        var msg = Object.assign({ type: 'canvas-request', id: id, kind: kind, session: session }, extra)
        if (buffer) window.parent.postMessage(msg, '*', [buffer])
        else window.parent.postMessage(msg, '*')
      })
    })
  }

  window.addEventListener('message', function (e) {
    // Only the viewer chrome may talk to the page. window.parent is
    // the iframe's parent; a message from anywhere else (a nested
    // frame, another tab) is ignored.
    if (e.source !== window.parent) return
    var d = e.data || {}
    if (d.type === 'canvas-init') {
      docId = d.docId
      session = d.session || null
      if (readyResolve) { readyResolve(); readyResolve = null }
      return
    }
    if (d.type === 'canvas-response') {
      if (pending[d.id]) {
        var p = pending[d.id]
        delete pending[d.id]
        if (d.ok) p.resolve(d.value)
        else p.reject(new Error(d.error || 'canvas error'))
      }
      // A download registers in downloads[], not pending[] — an error
      // reply for its id must reject it here or the promise hangs.
      if (!d.ok && downloads[d.id]) {
        var dl = downloads[d.id]
        delete downloads[d.id]
        dl.reject(new Error(d.error || 'canvas error'))
      }
      return
    }
    if (d.type === 'canvas-download-chunk' && downloads[d.id]) {
      var dl2 = downloads[d.id]
      if (d.error) { delete downloads[d.id]; dl2.reject(new Error(d.error)); return }
      if (d.data) dl2.chunks.push(d.data)
      if (d.meta) dl2.meta = d.meta
      if (d.done) {
        delete downloads[d.id]
        var blob = new Blob(dl2.chunks, { type: (dl2.meta && dl2.meta.contentType) || 'application/octet-stream' })
        blob.name = (dl2.meta && dl2.meta.filename) || 'download'
        dl2.resolve(blob)
      }
      return
    }
    if (d.type === 'canvas-state-changed' && subs[d.key]) {
      subs[d.key].forEach(function (cb) { cb(d.value) })
    }
  })

  function uploadFile(args) {
    var file = args.file
    if (!file || typeof file.slice !== 'function' || typeof file.size !== 'number') {
      return Promise.reject(new Error('canvas.files.upload needs a File or Blob'))
    }
    var total = file.size
    var uploadId = 'up_' + Date.now().toString(36) + '_' + Math.floor(Math.random() * 1e9).toString(36)
    return request('files:upload:start', { uploadId: uploadId, api: args.api, path: args.path, field: args.field, filename: file.name || 'upload', size: total, type: file.type || '' })
      .then(function (start) {
        var size = start.chunkSize || CHUNK
        var chunks = start.chunks
        var sent = 0
        var chain = Promise.resolve()
        for (var i = 0; i < chunks; i++) {
          (function (index) {
            chain = chain.then(function () {
              var s = index * size
              return file.slice(s, Math.min(s + size, total)).arrayBuffer().then(function (buf) {
                return requestChunk('files:upload:chunk', { uploadId: uploadId, index: index }, buf).then(function () {
                  sent += buf.byteLength
                  if (args.onProgress) args.onProgress({ sent: sent, total: total, chunks: chunks, index: index })
                })
              })
            })
          })(i)
        }
        return chain.then(function () {
          return request('files:upload:finish', { uploadId: uploadId })
        })
      })
  }

  function downloadFile(args) {
    if (window.parent === window) return notInViewer()
    return ready.then(function () {
      return new Promise(function (resolve, reject) {
        var id = nextId++
        downloads[id] = { chunks: [], meta: null, resolve: resolve, reject: reject }
        window.parent.postMessage({ type: 'canvas-request', id: id, kind: 'files:download', session: session, api: args.api, path: args.path, params: args.params || null }, '*')
      })
    })
  }

  window.canvas = {
    docId: function () { return docId },
    api: {
      // GET against the Canvas API itself (allowlisted on the chrome side).
      get: function (path) { return request('api', { method: 'GET', path: path }) },
      // A registered internal API, through the chrome. The page never
      // sees a token; the chrome resolves the registry entry and
      // fetches the token. Resolves with {status, data} — the API's
      // JSON body is in `data`, not at the top level.
      fetch: function (api, path, opts) {
        opts = opts || {}
        return request('api:fetch', { api: api, path: path, method: opts.method || 'GET', body: opts.body === undefined ? null : opts.body })
      },
    },
    state: {
      get: function (key) { return request('state:get', { key: key }) },
      all: function () { return request('state:all') },
      set: function (key, value) { return request('state:set', { key: key, value: value }) },
      delete: function (key) { return request('state:delete', { key: key }) },
      subscribe: function (key, cb) {
        (subs[key] = subs[key] || []).push(cb)
        return Promise.resolve(true)
      },
    },
    files: {
      upload: uploadFile,
      download: downloadFile,
      save: function (args) {
        return downloadFile(args).then(function (blob) {
          var filename = args.filename || blob.name || 'download'
          var url = URL.createObjectURL(blob)
          var a = document.createElement('a')
          a.href = url
          a.download = filename
          document.body.appendChild(a)
          a.click()
          a.remove()
          setTimeout(function () { URL.revokeObjectURL(url) }, 1000)
          return { filename: filename, size: blob.size }
        })
      },
    },
  }
})()
