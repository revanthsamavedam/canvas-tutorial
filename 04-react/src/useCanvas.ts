import { useEffect, useState } from 'react'

// The window.canvas surface, as the bridge provides it. This mirrors
// 01-bridge/bridge.ts — the React app is a separate program, so the
// shape is declared here rather than imported. `data` is the API's
// JSON body, untyped at the bridge layer; the caller knows what it
// asked for.
interface CanvasApiFetchOptions {
  method?: string
  body?: unknown
}

interface CanvasApiResponse {
  status: number
  data: any
}

interface CanvasBridge {
  docId: () => string | null
  api: {
    get: (path: string) => Promise<any>
    fetch: (api: string, path: string, opts?: CanvasApiFetchOptions) => Promise<CanvasApiResponse>
  }
  state: {
    get: (key: string) => Promise<any>
    all: () => Promise<any>
    set: (key: string, value: unknown) => Promise<any>
    delete: (key: string) => Promise<any>
    subscribe: (key: string, cb: (value: any) => void) => Promise<boolean>
  }
  files: {
    upload: (args: { file: File | Blob; api: string; path: string; field?: string; onProgress?: (progress: { sent: number; total: number; chunks: number; index: number }) => void }) => Promise<any>
    download: (args: { api: string; path: string; params?: unknown; filename?: string }) => Promise<Blob & { name: string }>
    save: (args: { api: string; path: string; params?: unknown; filename?: string }) => Promise<{ filename: string; size: number }>
  }
}

declare global {
  interface Window {
    canvas: CanvasBridge
  }
}

// useCanvas — React binding for the Canvas bridge (window.canvas).
//
// The bridge is injected by the viewer at render time (withCanvasShell
// in agent-docs-ui); until then window.canvas is undefined, and in
// plain viewing it never exists. The hook polls for it briefly on
// mount and reports readiness, so the app renders a fallback instead
// of crashing on an undefined bridge — the same graceful-fallback
// pattern Canvas pages use for unregistered APIs (sample data when
// the bridge is absent, live data when it is present).
//
// The bridge script is a classic script injected before </body>;
// this app's module script is deferred, so in the viewer window.canvas
// is normally already set when the app mounts. The poll covers the
// ordering case where it is not yet.
//
// Usage:
//   const { canvas, ready } = useCanvas()
//   const data = ready ? await canvas.api.fetch('riskhub', '/v1/docs') : null
export function useCanvas() {
  const [canvas, setCanvas] = useState<CanvasBridge | null>(
    typeof window !== 'undefined' ? window.canvas || null : null
  )

  useEffect(() => {
    if (window.canvas) {
      setCanvas(window.canvas)
      return undefined
    }
    let tries = 0
    const id = setInterval(() => {
      tries += 1
      if (window.canvas) {
        setCanvas(window.canvas)
        clearInterval(id)
      } else if (tries >= 20) {
        clearInterval(id)
      }
    }, 100)
    return () => clearInterval(id)
  }, [])

  return { canvas, ready: canvas !== null }
}

// useCanvasApi — fetch live data through the bridge when it is ready.
//
// Returns { data, loading, error }. data stays null while the bridge
// is absent (the caller shows its baked-in fallback); a failed call
// sets error and the caller keeps the fallback. deps re-runs the call
// when its entries change.
export function useCanvasApi(app: string, path: string, opts: CanvasApiFetchOptions | undefined, deps: unknown[] = []) {
  const { canvas, ready } = useCanvas()
  const [data, setData] = useState<unknown>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!ready) return undefined
    let cancelled = false
    setLoading(true)
    setError(null)
    // Call via window.canvas.api.fetch, not the destructured `canvas`:
    // the minifier renames a local variable, and the gate's bridge
    // carve-out matches the literal `canvas.api.fetch` name.
    // api.fetch resolves with {status, data} — the API's JSON body is
    // in `data`, so the hook exposes the body, not the envelope.
    window.canvas.api
      .fetch(app, path, opts)
      .then((res) => {
        if (!cancelled) setData(res.data)
      })
      .catch((e) => {
        if (!cancelled) setError(String(e && e.message ? e.message : e))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, app, path, JSON.stringify(opts), ...deps])

  return { data, loading, error, ready }
}
