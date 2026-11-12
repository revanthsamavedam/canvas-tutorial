import { useEffect, useState } from 'react'

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
  const [canvas, setCanvas] = useState(
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
export function useCanvasApi(app, path, opts, deps = []) {
  const { canvas, ready } = useCanvas()
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

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
