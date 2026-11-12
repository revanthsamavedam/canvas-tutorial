import React, { useEffect, useRef, useState } from "react";
import { createCanvasHost } from "./canvas/canvasHost.js";
import { createFilesHandler, validateRegistryCall } from "./canvas/files.js";
import { withCanvasShell } from "./canvas/csp.js";

// Canvas mode (branch `canvas`, opt-in): the standalone Canvas
// outer/inner shell, adapted to agent-docs. The chrome above is
// the outer shell; public/canvas-inner.html is the inner shell;
// canvas.state is this document's KV, canvas.api is the agent-docs
// API (GET-only, allowlisted in src/canvas/allowlist.js). The
// normal document viewer below is untouched — Canvas mode only
// swaps the iframe area, and only when the user turns it on.
// Since 2026-11-11 Canvas mode renders the selected document
// through withCanvasShell (src/canvas/csp.js) — CSP + lockdown +
// window.canvas, applied to a render copy only. With no version
// loaded it falls back to the static demo shell.

// Viewer chrome only. Document HTML is NEVER rendered by React:
// it is loaded in a sandboxed iframe. The stored HTML is never
// changed — the viewer only wraps it at render time with a
// bridge script that exposes window.agentdocs.kv,
// window.agentdocs.apiFetch, and window.agentdocs.navigate
// via postMessage to this chrome. Navigation: the chrome
// renders a nav bar over the document list, documents link
// to each other with window.agentdocs.navigate(docId) or
// <a data-agentdocs-doc="doc_...">, and ?doc=<id> deep-links
// a page. State stays document-scoped across navigation.
// kv calls the api repo's state endpoints; apiFetch resolves a
// registered internal API (or an author-provided token URL, if
// its origin is trusted), fetches that endpoint's token with
// the viewer's sign-in, calls the API, and returns only
// {status, data} to the document. Tokens never enter document
// code. apiFetch supports GET (default), POST, PUT, and DELETE;
// a GET with a body is rejected, and a POST is not auto-retried
// on 401 (a blind retry could duplicate a creation). No
// dangerouslySetInnerHTML, no parsing of document HTML anywhere
// in this app.
//
// Shared state is document-scoped, not version-scoped: changing
// it never creates a version, and it survives across versions.
//
// Drafts: an unpublished HTML snapshot, viewable on the actual
// viewer link (?doc=<id>&draft=1) through the same bridge as a
// published version, and published with one click. A draft is
// never a version, and saving one touches no published version.
// "Open local file as draft" creates a new draft-only document
// from a local file, so testing never clobbers a published page.
//
// The components below are plain React placeholders. Swap them
// for the approved component library later; no approved library
// name is invented or depended on here.
const API = (import.meta.env.VITE_API_URL || "http://127.0.0.1:8000").replace(
  /\/$/,
  ""
);

async function api(path) {
  const res = await fetch(`${API}${path}`);
  if (!res.ok) {
    throw new Error(`${res.status} ${path}`);
  }
  return res.json();
}

async function apiCall(path, method, body) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(`${res.status} ${path}`);
  }
  return res.json();
}

async function apiText(path) {
  const res = await fetch(`${API}${path}`);
  if (!res.ok) {
    throw new Error(`${res.status} ${path}`);
  }
  return res.text();
}

// Trusted token-URL origins, set in code by the maintainer
// before production (empty = no origin restriction in this
// build, for local onboarding; production should list the
// internal domains / Entra tenant allowed here).
const TRUSTED_TOKEN_URL_ORIGINS = [];

// Viewer token source — MAINTAINER: replace this with the real
// Entra token acquisition (e.g. MSAL acquireTokenSilent) before
// distributing the viewer. Returning null means token-URL calls
// are attempted without an Authorization header; token URLs
// that need a viewer token will fail until this is wired.
async function getViewerToken() {
  return null;
}

function jwtExpiryMs(token) {
  try {
    const payload = JSON.parse(atob(token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
    return payload.exp ? payload.exp * 1000 : null;
  } catch {
    return null;
  }
}

// Render-time bridge, injected into a copy of the stored HTML only.
// The stored version stays byte-identical; this script never lands
// in the api repo. It talks to the viewer chrome by postMessage,
// and the chrome talks to the api repo's /state endpoints.
const BRIDGE_SCRIPT = `
(function () {
  var pending = {};
  var nextId = 1;
  function call(op, key, value, patch) {
    return new Promise(function (resolve, reject) {
      var id = nextId++;
      pending[id] = { resolve: resolve, reject: reject };
      window.parent.postMessage(
        { type: "agentdocs-kv", id: id, op: op, key: key, value: value, patch: patch },
        "*"
      );
    });
  }
  window.addEventListener("message", function (e) {
    var d = e.data || {};
    if (d.type !== "agentdocs-kv-response" || !pending[d.id]) return;
    var p = pending[d.id];
    delete pending[d.id];
    if (d.ok) p.resolve(d.value);
    else p.reject(new Error(d.error || "kv error"));
  });
  var apiPending = {};
  window.addEventListener("message", function (e) {
    var d = e.data || {};
    if (d.type !== "agentdocs-api-response" || !apiPending[d.id]) return;
    var p = apiPending[d.id];
    delete apiPending[d.id];
    if (d.ok) p.resolve({ status: d.status, data: d.data });
    else p.reject(new Error(d.error || "api error"));
  });
  function apiFetch(apiRef, second, third) {
    // apiFetch("reports", "/reports/q3") — GET, registered name + path.
    // apiFetch("https://internal-a/api/reports") — GET, full URL, resolved via registry.
    // apiFetch("https://internal-a/api/reports", "https://internal-a/token") — GET, author-provided token URL.
    // apiFetch("reports", "/reports", { method: "POST", body: { status: "open" } }) — POST/PUT/DELETE.
    // apiFetch("reports", { method: "DELETE" }) — options as the second argument (path defaults to "").
    // The document never sees a token and never sets Authorization:
    // the viewer chrome adds the token and owns the call. A GET
    // with a body is rejected by the chrome, not sent.
    return new Promise(function (resolve, reject) {
      var id = nextId++;
      apiPending[id] = { resolve: resolve, reject: reject };
      var tokenUrl = null;
      var path = "";
      var options = null;
      if (second && typeof second === "object") {
        options = second;
      } else if (second && second.indexOf("http") === 0) {
        tokenUrl = second;
      } else {
        path = second || "";
      }
      if (third) options = third;
      window.parent.postMessage(
        { type: "agentdocs-api", id: id, apiRef: apiRef, path: path, tokenUrl: tokenUrl,
          method: options ? options.method : null, body: options ? options.body : null },
        "*"
      );
    });
  }
  function navigate(docId) {
    // navigate("doc_...") — ask the viewer chrome to switch pages.
    // A plain <a href> inside the sandboxed iframe would navigate
    // the iframe itself and lose the chrome, so navigation goes
    // through this bridge, same pattern as kv and apiFetch.
    window.parent.postMessage({ type: "agentdocs-navigate", docId: docId }, "*");
  }
  document.addEventListener("click", function (e) {
    var a = e.target && e.target.closest ? e.target.closest("a[data-agentdocs-doc]") : null;
    if (a) {
      e.preventDefault();
      navigate(a.getAttribute("data-agentdocs-doc"));
    }
  });
  var kv = {
    get: function (key) { return call("get", key); },
    all: function () { return call("all"); },
    set: function (key, value) { return call("set", key, value); },
    delete: function (key) { return call("delete", key); },
    patch: function (patch) { return call("patch", null, null, patch); },
  };
  window.agentdocs = { kv: kv, apiFetch: apiFetch, navigate: navigate };
  window.slashdocs = { kv: kv };
})();
`;

function withBridge(html) {
  const script = `<script>${BRIDGE_SCRIPT}<\/script>`;
  if (html.includes("</body>")) {
    return html.replace("</body>", `${script}</body>`);
  }
  return html + script;
}

export default function App() {
  const [documents, setDocuments] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [versions, setVersions] = useState([]);
  const [selectedVersionId, setSelectedVersionId] = useState(null);
  const [viewingDraft, setViewingDraft] = useState(false);
  const [hasDraft, setHasDraft] = useState(false);
  const [error, setError] = useState("");
  const [docSrc, setDocSrc] = useState("");
  // Canvas mode render copy: the selected document through the
  // canvas shell (CSP + lockdown + window.canvas). Empty while no
  // version is loaded — the iframe then falls back to the static
  // demo shell at /canvas-inner.html.
  const [canvasDocSrc, setCanvasDocSrc] = useState("");
  const [stateEntries, setStateEntries] = useState({});
  const [stateKey, setStateKey] = useState("");
  const [stateValue, setStateValue] = useState("");
  const [apis, setApis] = useState([]);
  const iframeRef = useRef(null);
  // Canvas mode state. canvasIframeRef is separate from iframeRef,
  // so the agentdocs bridge handlers (which check iframeRef) never
  // see Canvas messages, and vice versa.
  const [viewMode, setViewMode] = useState("docs");
  const canvasIframeRef = useRef(null);
  // Canvas bridge v2: a per-view session nonce (issued in
  // canvas-init, echoed on every request) and the store of partial
  // file uploads, which must survive re-renders.
  const canvasSessionRef = useRef(null);
  const canvasUploadsRef = useRef(new Map());
  const [canvasCode, setCanvasCode] = useState(
    "// QuickJS sandbox — same canvas host as the inner iframe.\n" +
      "// canvas.api.get looks sync; the chrome awaits the API for you.\n" +
      "const docs = canvas.api.get('/v1/documents');\n" +
      "const state = canvas.state.all();\n" +
      "'documents=' + docs.documents.length + ', state keys=' + Object.keys(state).join(',')"
  );
  const [canvasResult, setCanvasResult] = useState(null);
  const [canvasRunning, setCanvasRunning] = useState(false);
  const [canvasLog, setCanvasLog] = useState([]);

  function canvasHost() {
    return createCanvasHost({
      apiBase: API,
      docId: selectedId,
      onLog: (e) => setCanvasLog((prev) => [...prev, e].slice(-20)),
      callRegisteredApi,
      fetchBinary: fetchBinaryFromRegistry,
    });
  }

  async function runCanvasSandbox() {
    if (!selectedId) return;
    setCanvasRunning(true);
    setCanvasResult(null);
    try {
      // Dynamic import: the normal viewer never loads QuickJS/WASM.
      const { runJS } = await import("./canvas/run.js");
      const started = Date.now();
      const res = await runJS(canvasCode, { host: canvasHost(), timeoutMs: 5000 });
      setCanvasResult({ ...res, ms: Date.now() - started });
    } catch (e) {
      setCanvasResult({ result: undefined, output: "", error: String(e.message || e) });
    } finally {
      setCanvasRunning(false);
      await loadState(selectedId);
    }
  }
  const draftFileRef = useRef(null);
  const apisRef = useRef([]);
  const documentsRef = useRef([]);
  const tokenCacheRef = useRef(new Map());

  async function refreshDocuments() {
    const data = await api("/v1/documents");
    const docs = data.documents || [];
    setDocuments(docs);
    documentsRef.current = docs;
    return docs;
  }

  useEffect(() => {
    api("/v1/documents")
      .then((data) => {
        const docs = data.documents || [];
        setDocuments(docs);
        documentsRef.current = docs;
        // Deep-link: ?doc=<id> opens that page on load, so nav
        // links are shareable and bookmarkable. ?doc=<id>&draft=1
        // opens its draft on the actual viewer link instead.
        const params = new URLSearchParams(window.location.search);
        const wanted = params.get("doc");
        if (wanted && docs.some((d) => d.id === wanted)) {
          openDocument(wanted, params.get("draft") === "1");
        }
      })
      .catch((e) => setError(String(e)));
    api("/v1/apis")
      .then((data) => {
        // Normalize the registry entry shape: the API returns
        // {app_name, base_url, token_url} but the chrome-side bridge
        // code reads {name, api_url}. Without this, the lookup never
        // matches and every bridge call fails api_not_registered —
        // even though the API is registered (verified 2026-11-11:
        // the E2E failed exactly this way).
        const list = (data.apis || []).map((a) => ({
          name: a.app_name ?? a.name,
          api_url: a.base_url ?? a.api_url,
          token_url: a.token_url,
          scope: a.scope,
        }));
        setApis(list);
        apisRef.current = list;
      })
      .catch(() => setApis([]));
  }, []);

  async function loadState(docId) {
    try {
      const data = await api(`/v1/documents/${docId}/state`);
      setStateEntries(data.state || {});
    } catch (e) {
      setStateEntries({});
    }
  }

  async function openDocument(docId, wantDraft = false) {
    setError("");
    setSelectedId(docId);
    try {
      const url = wantDraft
        ? `?doc=${encodeURIComponent(docId)}&draft=1`
        : `?doc=${encodeURIComponent(docId)}`;
      window.history.replaceState(null, "", url);
    } catch {
      // Non-browser / restricted contexts: URL sync is best-effort.
    }
    try {
      const data = await api(`/v1/documents/${docId}/versions`);
      setVersions(data.versions || []);
      const latest = (data.versions || []).at(-1);
      await loadState(docId);
      // A draft is rendered from the API's stored draft, through
      // the same bridge as a published version — so the author
      // tests on the actual viewer link, with apiFetch, kv, and
      // navigate working, before anything is published.
      let draft = null;
      try {
        draft = await api(`/v1/documents/${docId}/draft`);
        setHasDraft(true);
      } catch {
        setHasDraft(false);
      }
      if (wantDraft && draft) {
        setViewingDraft(true);
        setSelectedVersionId(null);
        setDocSrc(withBridge(draft.html));
      } else {
        if (wantDraft) setError("No draft for this document — showing the published version.");
        setViewingDraft(false);
        // Versions have no id — the version NUMBER is the identity
        // (store.py: "no version ids"; the API returns `number`, and
        // the /versions/{number}/html route takes the number). The
        // old `latest.id` was always undefined, so selectedVersionId
        // stayed falsy and no version HTML was ever fetched — in the
        // normal viewer or in Canvas mode.
        setSelectedVersionId(latest ? latest.number : null);
        if (!latest) setDocSrc("");
      }
    } catch (e) {
      setError(String(e));
    }
  }

  // Open a local file as a draft: creates a new draft-only
  // document (nothing is published), then opens it on the
  // actual viewer link. Testing a local file never clobbers
  // a published document.
  async function openLocalFileAsDraft(file) {
    if (!file) return;
    setError("");
    try {
      const html = await file.text();
      const title = file.name.replace(/\.html?$/i, "") || file.name;
      const created = await apiCall("/v1/documents", "POST", { title, html, draft: true });
      await refreshDocuments();
      await openDocument(created.id, true);
    } catch (e) {
      setError(String(e));
    }
  }

  useEffect(() => {
    if (viewingDraft) return;
    if (!selectedId || !selectedVersionId) {
      setDocSrc("");
      return;
    }
    apiText(`/v1/documents/${selectedId}/versions/${selectedVersionId}/html`)
      .then((html) => setDocSrc(withBridge(html)))
      .catch((e) => setError(String(e)));
  }, [selectedId, selectedVersionId, viewingDraft]);

  // Canvas mode render: the same version HTML the normal viewer
  // loads, wrapped at render time with the canvas shell (CSP +
  // lockdown + window.canvas) — never the stored version, which
  // stays byte-identical. Drafts render in the normal viewer only;
  // Canvas mode shows the published version. The chrome-side
  // canvas-request handlers already target canvasIframeRef, so
  // they work unchanged once the document is in the frame.
  useEffect(() => {
    if (viewMode !== "canvas" || viewingDraft) {
      setCanvasDocSrc("");
      return;
    }
    if (!selectedId || !selectedVersionId) {
      setCanvasDocSrc("");
      return;
    }
    apiText(`/v1/documents/${selectedId}/versions/${selectedVersionId}/html`)
      .then((html) => setCanvasDocSrc(withCanvasShell(html)))
      .catch((e) => setError(String(e)));
  }, [viewMode, selectedId, selectedVersionId, viewingDraft]);

  // Bridge replies: document JS -> chrome -> api repo -> document JS.
  // Only messages from this viewer iframe are honoured.
  useEffect(() => {
    async function onMessage(e) {
      const frame = iframeRef.current;
      if (!frame || e.source !== frame.contentWindow) return;
      const d = e.data || {};
      if (d.type !== "agentdocs-kv" || !selectedId) return;
      try {
        let value;
        if (d.op === "all") {
          value = (await api(`/v1/documents/${selectedId}/state`)).state;
        } else if (d.op === "get") {
          value = (await api(`/v1/documents/${selectedId}/state/${encodeURIComponent(d.key)}`)).value;
        } else if (d.op === "set") {
          await apiCall(`/v1/documents/${selectedId}/state/${encodeURIComponent(d.key)}`, "PUT", { value: d.value });
          value = d.value;
        } else if (d.op === "delete") {
          await apiCall(`/v1/documents/${selectedId}/state/${encodeURIComponent(d.key)}`, "DELETE");
          value = null;
        } else if (d.op === "patch") {
          value = (await apiCall(`/v1/documents/${selectedId}/state`, "POST", { patch: d.patch })).state;
        } else {
          throw new Error(`unknown kv op ${d.op}`);
        }
        frame.contentWindow.postMessage({ type: "agentdocs-kv-response", id: d.id, ok: true, value }, "*");
        await loadState(selectedId);
      } catch (err) {
        frame.contentWindow.postMessage({ type: "agentdocs-kv-response", id: d.id, ok: false, error: String(err) }, "*");
      }
    }
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [selectedId]);

  // apiFetch bridge: document -> chrome -> token URL -> internal API -> document.
  // The document never receives a token. Tokens are cached per API
  // until expiry, refreshed once on a 401, and never stored.
  async function fetchTokenFor(entry) {
    const cached = tokenCacheRef.current.get(entry.name || entry.api_url);
    if (cached && cached.exp && cached.exp > Date.now() + 60000) {
      return cached.token;
    }
    const viewerToken = await getViewerToken();
    const headers = { "Content-Type": "application/json" };
    if (viewerToken) headers.Authorization = `Bearer ${viewerToken}`;
    const body = entry.scope ? { scope: entry.scope } : {};
    const res = await fetch(entry.token_url, { method: "POST", headers, body: JSON.stringify(body) });
    if (!res.ok) throw new Error(`token fetch failed ${res.status}`);
    const data = await res.json();
    const token = data.access_token;
    if (!token) throw new Error("token URL did not return an access_token");
    const exp = jwtExpiryMs(token);
    tokenCacheRef.current.set(entry.name || entry.api_url, { token, exp });
    return token;
  }

  // Methods the bridge supports. GET is the default. POST/PUT/
  // DELETE go through the same registry lookup, token fetch, and
  // trusted-origin checks as GET — the document still never sees
  // a token and cannot set Authorization (the chrome sets it).
  const API_METHODS = ["GET", "POST", "PUT", "DELETE"];

  async function callRegisteredApi(apiRef, path, tokenUrlOverride, options) {
    const method = (options?.method || "GET").toUpperCase();
    if (!API_METHODS.includes(method)) {
      throw new Error("unsupported_method");
    }
    if (method === "GET" && options?.body !== undefined && options?.body !== null) {
      throw new Error("get_with_body_not_allowed");
    }
    let entry = apisRef.current.find((a) => a.name === apiRef);
    let fullUrl;
    if (entry) {
      const base = entry.api_url.replace(/\/$/, "");
      fullUrl = path ? `${base}/${String(path).replace(/^\//, "")}` : base;
    } else if (typeof apiRef === "string" && apiRef.indexOf("http") === 0) {
      fullUrl = apiRef;
      entry = apisRef.current.find((a) => fullUrl.indexOf(a.api_url.replace(/\/$/, "")) === 0);
      if (!entry && tokenUrlOverride) {
        if (TRUSTED_TOKEN_URL_ORIGINS.length > 0) {
          const origin = new URL(tokenUrlOverride).host;
          if (!TRUSTED_TOKEN_URL_ORIGINS.includes(origin)) {
            throw new Error("token URL origin not trusted");
          }
        }
        entry = { name: fullUrl, api_url: fullUrl, token_url: tokenUrlOverride, scope: "" };
      }
      if (!entry) throw new Error("api_not_registered");
    } else {
      throw new Error("api_not_registered");
    }
    async function doCall() {
      const token = await fetchTokenFor(entry);
      const headers = { Authorization: `Bearer ${token}` };
      const init = { method, headers };
      if (options?.body !== undefined && options?.body !== null) {
        if (options.isMultipart) {
          // FormData: the browser sets the multipart boundary, so
          // no Content-Type here — setting one would break it.
          init.body = options.body;
        } else {
          headers["Content-Type"] = "application/json";
          init.body = typeof options.body === "string" ? options.body : JSON.stringify(options.body);
        }
      }
      return fetch(fullUrl, init);
    }
    let res = await doCall();
    // 401 retry, once — but only for idempotent methods. A POST
    // is not retried automatically: if the first attempt was
    // actually applied, a blind retry could create a duplicate.
    // A POST that returns 401 is returned to the document, which
    // can retry explicitly if it knows the call is safe to repeat.
    if (res.status === 401 && method !== "POST") {
      tokenCacheRef.current.delete(entry.name || entry.api_url);
      res = await doCall();
    }
    // Raw mode (files.download): binary, not JSON. The caller gets
    // the bytes plus content type and disposition, never a token.
    if (options?.raw) {
      return {
        status: res.status,
        data: await res.arrayBuffer(),
        contentType: res.headers.get("content-type"),
        contentDisposition: res.headers.get("content-disposition"),
      };
    }
    let data;
    try {
      data = await res.json();
    } catch {
      data = await res.text();
    }
    return { status: res.status, data };
  }

  // Binary fetch for canvas.files.download: same registry lookup
  // and token flow as callRegisteredApi, but the response is bytes.
  // The filename comes from Content-Disposition when the API sets
  // it, else the last path segment. Never returns a token.
  async function fetchBinaryFromRegistry(api, path, params) {
    const query =
      params && Object.keys(params).length > 0
        ? "?" + new URLSearchParams(params).toString()
        : "";
    const res = await callRegisteredApi(api, path + query, null, { method: "GET", raw: true });
    if (res.status < 200 || res.status >= 300) {
      throw new Error(`download failed ${res.status}`);
    }
    let filename = null;
    const disp = res.contentDisposition || "";
    const m = disp.match(/filename\*?=(?:UTF-8''|")?([^";]+)"?/i);
    if (m) filename = decodeURIComponent(m[1]);
    return { bytes: res.data, contentType: res.contentType, filename };
  }

  // Navigate bridge: document -> chrome -> switch document.
  // Only a document id already in the viewer's list is honoured;
  // an unknown id is ignored, never fetched blindly.
  useEffect(() => {
    function onNavigateMessage(e) {
      const frame = iframeRef.current;
      if (!frame || e.source !== frame.contentWindow) return;
      const d = e.data || {};
      if (d.type !== "agentdocs-navigate") return;
      if (documentsRef.current.some((doc) => doc.id === d.docId)) {
        openDocument(d.docId);
      }
    }
    window.addEventListener("message", onNavigateMessage);
    return () => window.removeEventListener("message", onNavigateMessage);
  }, []);

  useEffect(() => {
    async function onApiMessage(e) {
      const frame = iframeRef.current;
      if (!frame || e.source !== frame.contentWindow) return;
      const d = e.data || {};
      if (d.type !== "agentdocs-api") return;
      try {
        const result = await callRegisteredApi(d.apiRef, d.path, d.tokenUrl, { method: d.method, body: d.body });
        frame.contentWindow.postMessage({ type: "agentdocs-api-response", id: d.id, ok: true, status: result.status, data: result.data }, "*");
      } catch (err) {
        frame.contentWindow.postMessage({ type: "agentdocs-api-response", id: d.id, ok: false, error: String(err) }, "*");
      }
    }
    window.addEventListener("message", onApiMessage);
    return () => window.removeEventListener("message", onApiMessage);
  }, []);

  // Canvas bridge: inner iframe -> chrome -> agent-docs API / KV /
  // registered APIs / files. Only messages from the Canvas iframe
  // are honoured (canvasIframeRef, not iframeRef). Every request
  // must echo the per-view session nonce from canvas-init: a
  // request from a stale view (old document) is rejected, and a
  // partial upload is dropped when the view changes. After a state
  // write, the chrome broadcasts canvas-state-changed to the inner
  // frame and reloads the state panel, so Canvas state and the
  // normal state panel stay in sync.
  useEffect(() => {
    async function onCanvasMessage(e) {
      const frame = canvasIframeRef.current;
      if (!frame || e.source !== frame.contentWindow) return;
      const d = e.data || {};
      if (d.type !== "canvas-request" || !d.id || !selectedId) return;
      const host = canvasHost();
      const reply = (ok, value, error) =>
        frame.contentWindow.postMessage({ type: "canvas-response", id: d.id, ok, value, error }, "*");
      if (!d.session || d.session !== canvasSessionRef.current) {
        reply(false, undefined, "STALE_SESSION");
        return;
      }
      // One files handler per message, sharing the upload store in
      // the ref, so partial uploads survive re-renders while the
      // registry caller is always the current render's.
      const filesHandler = createFilesHandler({
        callRegisteredApi,
        fetchBinary: fetchBinaryFromRegistry,
        onLog: (ev) => setCanvasLog((prev) => [...prev, ev].slice(-20)),
        isAppRegistered: (name) => apisRef.current.some((a) => a.name === name),
        store: canvasUploadsRef.current,
      });
      try {
        if (d.kind === "api") {
          reply(true, await host.canvas.api.get(d.path));
        } else if (d.kind === "api:fetch") {
          const v = validateRegistryCall({ api: d.api, path: d.path, method: d.method, body: d.body });
          if (!v.ok) throw new Error(v.error);
          reply(true, await callRegisteredApi(d.api, d.path, null, { method: v.method, body: d.body ?? null }));
        } else if (d.kind === "state:get") {
          reply(true, await host.canvas.state.get(d.key));
        } else if (d.kind === "state:all") {
          reply(true, await host.canvas.state.all());
        } else if (d.kind === "state:set") {
          const value = await host.canvas.state.set(d.key, d.value);
          frame.contentWindow.postMessage({ type: "canvas-state-changed", key: d.key, value }, "*");
          await loadState(selectedId);
          reply(true, value);
        } else if (d.kind === "state:delete") {
          await host.canvas.state.delete(d.key);
          frame.contentWindow.postMessage({ type: "canvas-state-changed", key: d.key, value: null }, "*");
          await loadState(selectedId);
          reply(true, null);
        } else if (d.kind === "files:upload:start") {
          reply(true, filesHandler.startUpload(d));
        } else if (d.kind === "files:upload:chunk") {
          reply(true, filesHandler.receiveChunk({ uploadId: d.uploadId, index: d.index, data: d.data }));
        } else if (d.kind === "files:upload:finish") {
          reply(true, await filesHandler.finishUpload({ uploadId: d.uploadId }));
        } else if (d.kind === "files:upload:cancel") {
          reply(true, filesHandler.cancelUpload({ uploadId: d.uploadId }));
        } else if (d.kind === "files:download") {
          // Downloads stream back as canvas-download-chunk messages,
          // not one canvas-response: the client reassembles a Blob.
          // Any failure is a single error chunk.
          try {
            await filesHandler.download({
              api: d.api,
              path: d.path,
              params: d.params,
              onChunk: (c) =>
                frame.contentWindow.postMessage(
                  { type: "canvas-download-chunk", id: d.id, index: c.index, total: c.total, data: c.data, done: c.done, meta: c.meta },
                  "*",
                  [c.data]
                ),
            });
          } catch (dlErr) {
            frame.contentWindow.postMessage({ type: "canvas-download-chunk", id: d.id, error: String(dlErr.message || dlErr) }, "*");
          }
        } else {
          reply(false, undefined, "UNKNOWN_KIND");
        }
      } catch (err) {
        reply(false, undefined, String(err.message || err));
      }
    }
    window.addEventListener("message", onCanvasMessage);
    return () => window.removeEventListener("message", onCanvasMessage);
  }, [selectedId]);

  return (
    <div className="layout">
      <aside className="sidebar">
        <h1>agent-docs</h1>
        <p className="hint">Publish, view, version history, and shared state.</p>
        <button onClick={() => setViewMode(viewMode === "canvas" ? "docs" : "canvas")}>
          {viewMode === "canvas" ? "Back to documents" : "Canvas mode"}
        </button>
        <p className="hint">
          Canvas mode: the outer shell is this chrome, the inner shell
          is a sandboxed iframe with fetch blocked. Data, state, and
          files go only through window.canvas to this chrome:
          canvas.api (agent-docs API + registered APIs), canvas.state
          (this document's KV), canvas.files (upload/download through
          a registered API). The normal viewer is unchanged.
        </p>
        {error && <p className="error">{error}</p>}
        <input
          ref={draftFileRef}
          type="file"
          accept=".html,text/html"
          style={{ display: "none" }}
          onChange={(e) => {
            openLocalFileAsDraft(e.target.files && e.target.files[0]);
            e.target.value = "";
          }}
        />
        <button onClick={() => draftFileRef.current && draftFileRef.current.click()}>
          Open local file as draft
        </button>
        <p className="hint">
          Creates a draft (nothing published) and opens it on the
          actual viewer link, with live data and state working.
        </p>
        <ul>
          {documents.map((d) => (
            <li key={d.id}>
              <button
                className={d.id === selectedId ? "active" : ""}
                onClick={() => openDocument(d.id)}
              >
                {d.title}
                <span>
                  {d.latest_version ? `latest v${d.latest_version}` : "draft only"}
                  {d.has_draft ? " · draft" : ""}
                </span>
              </button>
            </li>
          ))}
        </ul>
        {documents.length === 0 && !error && (
          <p className="hint">No documents yet. Publish one via the MCP or CLI.</p>
        )}
        <h2>Registered APIs</h2>
        {apis.length === 0 ? (
          <p className="hint">None yet. Register one via `apis register` (CLI) or `register_api` (MCP).</p>
        ) : (
          <ul>
            {apis.map((a) => (
              <li key={a.name}>
                {a.name}
                <span>{a.api_url}</span>
                {a.swagger_url && <span>swagger: {a.swagger_url}</span>}
              </li>
            ))}
          </ul>
        )}
      </aside>
      <main className="viewer">
        {documents.length > 0 && (
          <nav className="doc-nav" aria-label="Site navigation">
            {documents.map((d) => (
              <button
                key={d.id}
                className={d.id === selectedId ? "active" : ""}
                onClick={() => openDocument(d.id)}
              >
                {d.title}
              </button>
            ))}
          </nav>
        )}
        {viewingDraft && selectedId && (
          <div className="toolbar">
            <strong>Draft — not published</strong>
            <span className="hint">
              This is the actual viewer link (
              {`?doc=${selectedId}&draft=1`}) — share it to review.
              Nothing here is a version yet.
            </span>{" "}
            <button
              onClick={async () => {
                await apiCall(`/v1/documents/${selectedId}/draft/publish`, "POST", {});
                await refreshDocuments();
                await openDocument(selectedId);
              }}
            >
              Publish draft
            </button>{" "}
            <button
              onClick={async () => {
                await apiCall(`/v1/documents/${selectedId}/draft`, "DELETE");
                await refreshDocuments();
                await openDocument(selectedId);
              }}
            >
              Discard draft
            </button>
          </div>
        )}
        {!viewingDraft && selectedId && hasDraft && (
          <div className="toolbar">
            <span className="hint">This document has a draft.</span>{" "}
            <button onClick={() => openDocument(selectedId, true)}>View draft</button>
          </div>
        )}
        {selectedVersionId && (
          <div className="toolbar">
            <label>
              Version{" "}
              <select
                value={selectedVersionId}
                onChange={(e) => setSelectedVersionId(e.target.value)}
              >
                {versions.map((v) => (
                  <option key={v.number} value={v.number}>
                    v{v.number}
                  </option>
                ))}
              </select>
            </label>
            <span className="hint">
              Latest is the default; any older version is viewable.
            </span>
          </div>
        )}
        {selectedId && (
          <div className="toolbar">
            <strong>Document state</strong>
            <span className="hint">
              Shared, document-scoped — survives versions, never creates one.
            </span>
            <ul>
              {Object.entries(stateEntries).map(([k, v]) => (
                <li key={k}>
                  {k}: {JSON.stringify(v)}{" "}
                  <button
                    onClick={async () => {
                      await apiCall(`/v1/documents/${selectedId}/state/${encodeURIComponent(k)}`, "DELETE");
                      await loadState(selectedId);
                    }}
                  >
                    Delete
                  </button>
                </li>
              ))}
            </ul>
            <label>
              Key{" "}
              <input value={stateKey} onChange={(e) => setStateKey(e.target.value)} />
            </label>{" "}
            <label>
              Value (JSON, or plain text){" "}
              <input value={stateValue} onChange={(e) => setStateValue(e.target.value)} />
            </label>{" "}
            <button
              onClick={async () => {
                if (!stateKey) return;
                let parsed;
                try {
                  parsed = JSON.parse(stateValue);
                } catch {
                  parsed = stateValue;
                }
                await apiCall(`/v1/documents/${selectedId}/state/${encodeURIComponent(stateKey)}`, "PUT", { value: parsed });
                setStateKey("");
                setStateValue("");
                await loadState(selectedId);
              }}
            >
              Set
            </button>
          </div>
        )}
        {viewMode === "canvas" ? (
          selectedId ? (
            <div>
              <div className="toolbar">
                <strong>Canvas mode — outer shell: this chrome; inner shell: the selected document through the canvas shell</strong>
                <span className="hint">
                  Inner fetch is blocked (CSP connect-src 'none' + lockdown).
                  Data, state, and files go only through window.canvas to
                  this chrome. With no version loaded, the demo shell at
                  /canvas-inner.html is shown instead.
                </span>
              </div>
              {/* src and srcDoc are mutually exclusive: when a version
                  is loaded the iframe must have NO src attribute at
                  all. React updating srcDoc on an iframe that already
                  loaded via src does not reliably navigate it to the
                  srcDoc content — it kept showing the demo shell at
                  /canvas-inner.html. With no src attribute, the only
                  content is the srcDoc document. The `key` forces a
                  remount when the iframe switches between the demo
                  shell and a document: the src-to-srcDoc transition
                  on one element is racy in Chromium (the demo load
                  can win over the srcDoc navigation), so a fresh
                  element per state makes the load deterministic. */}
              <iframe
                key={canvasDocSrc ? "doc" : "demo"}
                ref={canvasIframeRef}
                title="Canvas inner"
                {...(canvasDocSrc
                  ? { srcDoc: canvasDocSrc }
                  : { src: "/canvas-inner.html" })}
                sandbox="allow-scripts"
                className="doc-frame"
                onLoad={() => {
                  const f = canvasIframeRef.current;
                  if (!f) return;
                  // Fresh session per view: the old nonce stops
                  // working, and any partial upload from the old
                  // view is dropped.
                  canvasSessionRef.current =
                    (window.crypto && window.crypto.randomUUID
                      ? window.crypto.randomUUID()
                      : "s_" + Date.now().toString(36) + "_" + Math.floor(Math.random() * 1e9).toString(36));
                  canvasUploadsRef.current.clear();
                  f.contentWindow.postMessage({ type: "canvas-init", docId: selectedId, session: canvasSessionRef.current }, "*");
                }}
              />
              <div style={{ padding: 12 }}>
                <h3>JS sandbox — QuickJS, same canvas host, no Docker</h3>
                <p className="hint">
                  Untrusted JS runs in a fresh QuickJS/WASM interpreter,
                  not in this page's V8. It has no fetch or token — only
                  the canvas host above. Sandbox compute time only counts
                  against the timeout; time awaiting the API does not.
                </p>
                <textarea
                  value={canvasCode}
                  onChange={(e) => setCanvasCode(e.target.value)}
                  rows={8}
                  spellCheck={false}
                  style={{ width: "100%", fontFamily: "monospace", fontSize: 13, padding: 10, boxSizing: "border-box" }}
                />
                <div style={{ marginTop: 8 }}>
                  <button onClick={runCanvasSandbox} disabled={canvasRunning}>
                    {canvasRunning ? "Running…" : "Run in sandbox"}
                  </button>
                </div>
                {canvasResult && (
                  <pre style={{ background: "#f5f5f5", padding: 10, whiteSpace: "pre-wrap" }}>
                    {JSON.stringify(canvasResult, null, 2)}
                  </pre>
                )}
                {canvasLog.length > 0 && (
                  <ul>
                    {canvasLog.map((e, i) => (
                      <li key={i}>
                        {e.label} — {e.status}
                        {e.ms != null ? ` (${e.ms}ms)` : ""}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          ) : (
            <p className="hint">Select a document in the sidebar first — Canvas state is document-scoped.</p>
          )
        ) : docSrc ? (
          <iframe
            ref={iframeRef}
            title="Document"
            srcDoc={docSrc}
            // Sandboxed render surface. allow-scripts lets the document's
            // own scripts run (including the render-time kv bridge);
            // allow-same-origin is deliberately NOT set, so document
            // code cannot reach this app's origin. The stored HTML is
            // unchanged; the bridge is added only to this render copy.
            sandbox="allow-scripts"
            className="doc-frame"
          />
        ) : (
          <p className="hint">Select a document to view it.</p>
        )}
      </main>
    </div>
  );
}
