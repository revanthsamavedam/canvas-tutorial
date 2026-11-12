// shell.js — the inner shell: CSP + lockdown + bridge injection.
//
// The viewer never serves a stored page as-is. It wraps it in a
// *render copy* with withCanvasShell() and serves that. The stored
// page is never changed. This file is a minimal version of
// agent-docs-ui/src/canvas/csp.js (same CSP string, same lockdown
// shape, same injection points).
//
// Two layers, in this order, before any page code runs:
//   1. CSP (browser-enforced, JS cannot undo it): connect-src 'none'
//      blocks fetch / XHR / WebSocket / EventSource / sendBeacon.
//      postMessage is not network, so window.canvas still works.
//   2. Lockdown script: replaces those globals with throwing stubs
//      (a clear error, not the enforcement) and blocks creating
//      nested frames — a nested frame would be a fresh realm with
//      fresh globals.
//
// The bridge client is injected just before </body>. The page's own
// scripts run first (they are in <head> or earlier in <body>), but
// the bridge is a classic script and the page's module scripts are
// deferred, so window.canvas exists by the time a React app mounts.
// The bridge client itself is ../01-bridge/bridge.js.
//
// The inner shell's public surface: the CSP string and the function
// that wraps a stored page in a render copy.
interface CanvasShell {
  CANVAS_CSP: string
  withCanvasShell: (html: string, bridgeSource: string) => string
}

interface Window {
  CanvasShell: CanvasShell
}

(function () {
  var CANVAS_CSP =
    "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; " +
    "img-src data:; media-src 'none'; font-src 'none'; connect-src 'none'; " +
    "object-src 'none'; frame-src 'none'; worker-src 'none'; form-action 'none'; " +
    "base-uri 'none'; manifest-src 'none'"

  // Read the CSP as a list of refusals:
  //   default-src 'none'    — nothing allowed unless another rule says so
  //   script-src 'unsafe-inline' — only inline scripts; no CDN libraries
  //   style-src 'unsafe-inline'  — only inline styles
  //   img-src data:         — images only as data: URLs embedded in the page
  //   connect-src 'none'    — NO NETWORK. fetch, XHR, WebSocket, EventSource, sendBeacon all blocked by the browser.
  //   object-src / frame-src / worker-src 'none' — no plugins, no nested frames, no workers
  //   form-action 'none'    — no native form submission (use a button + the bridge)
  //   base-uri / manifest-src 'none' — no base-URL tricks, no manifest

  var LOCKDOWN_SCRIPT = `(function () {
  function blocked(name) {
    return function () { throw new Error('Canvas inner shell: ' + name + ' is blocked. Use window.canvas.* via the outer shell.'); };
  }
  function lock(obj, prop, value) {
    try { Object.defineProperty(obj, prop, { value: value, writable: false, configurable: false }); }
    catch (e) { try { obj[prop] = value; } catch (_) {} }
  }
  lock(window, 'fetch', blocked('fetch'));
  lock(window, 'XMLHttpRequest', blocked('XMLHttpRequest'));
  lock(window, 'WebSocket', blocked('WebSocket'));
  lock(window, 'EventSource', blocked('EventSource'));
  lock(window, 'Worker', blocked('Worker'));
  lock(window, 'SharedWorker', blocked('SharedWorker'));
  lock(window, 'open', blocked('window.open'));
  try { lock(Navigator.prototype, 'sendBeacon', blocked('sendBeacon')); } catch (e) {}
  var origCreate = Document.prototype.createElement;
  Document.prototype.createElement = function (tag) {
    var t = String(tag || '').toLowerCase();
    if (t === 'iframe' || t === 'object' || t === 'embed' || t === 'frame') {
      throw new Error('Canvas inner shell: <' + t + '> is blocked.');
    }
    return origCreate.apply(this, arguments);
  };
  document.addEventListener('click', function (e) {
    var a = e.target && e.target.closest ? e.target.closest('a') : null;
    if (!a) return;
    var href = a.getAttribute('href') || '';
    // blob: and data: links are local downloads, not navigation:
    // canvas.files.save triggers a download this way, and it must
    // not be blocked. Anything else that would navigate away is.
    if (href.startsWith('#') || href.startsWith('blob:') || href.startsWith('data:')) return;
    e.preventDefault(); e.stopPropagation();
  }, true);
  document.addEventListener('submit', function (e) { e.preventDefault(); e.stopPropagation(); }, true);
})();`

  // BRIDGE_SOURCE is set by the viewer (viewer.html inlines
  // ../01-bridge/bridge.js into this variable before loading shell.js).
  // Keeping it out of this file means the bridge client lives in one
  // place (01-bridge/bridge.js) and the shell just injects it.
  //
  // The bridge goes before the LAST </body>, not the first one.
  // A page's own script can contain the literal string "</body>"
  // (this repo's sample page has it in a comment) — a first-match
  // replace injects the bridge in the middle of that script, the
  // injected </script> closes the page's <script> early, and the
  // rest of the page's code renders as visible text. The real
  // agent-docs-ui withCanvasShell has this same first-match bug.
  function withCanvasShell(html: string, bridgeSource: string): string {
    var cspMeta = '<meta http-equiv="Content-Security-Policy" content="' + CANVAS_CSP + '">'
    var lockdown = '<script>' + LOCKDOWN_SCRIPT + '<\/script>'
    var bridge = '<script>' + bridgeSource + '<\/script>'
    var out = html
    if (out.indexOf('<head>') !== -1) {
      out = out.replace('<head>', '<head>' + cspMeta + lockdown)
    } else {
      out = cspMeta + lockdown + out
    }
    var bodyClose = out.toLowerCase().lastIndexOf('</body>')
    if (bodyClose !== -1) {
      out = out.slice(0, bodyClose) + bridge + out.slice(bodyClose)
    } else {
      out = out + bridge
    }
    return out
  }

  window.CanvasShell = { CANVAS_CSP: CANVAS_CSP, withCanvasShell: withCanvasShell }
})()
