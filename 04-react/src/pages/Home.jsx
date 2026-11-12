import { useState } from 'react'
import { Layers, ShieldCheck } from 'lucide-react'
import { Button, Card, Stat } from '@canvas-lib'
import { useCanvas } from '../useCanvas'

// Demo data only — baked in at build time. No network calls: a Canvas
// page cannot fetch directly; live data comes through the window.canvas
// bridge. The hook reports whether the bridge is present; when it is
// absent the page shows this baked-in data, and when it is present the
// app can call canvas.api.fetch instead (see useCanvasApi).
export function Home() {
  const [opened, setOpened] = useState(false)
  const { ready } = useCanvas()
  const [liveDocs, setLiveDocs] = useState(null)
  const [liveLoading, setLiveLoading] = useState(false)
  const [liveError, setLiveError] = useState(null)

  async function loadLiveDocs() {
    if (!window.canvas) return
    setLiveLoading(true)
    setLiveError(null)
    try {
      // Call via window.canvas.api.fetch, not a destructured variable:
      // the minifier renames a local `canvas` variable, and the gate's
      // bridge carve-out matches the literal `canvas.api.fetch` name.
      // api.fetch resolves with {status, data} — the API's JSON body
      // is in `data`, not at the top level (protocol §6.2).
      const res = await window.canvas.api.fetch('riskhub', '/v1/docs')
      setLiveDocs(res.data)
    } catch (e) {
      setLiveError(String(e && e.message ? e.message : e))
    } finally {
      setLiveLoading(false)
    }
  }

  return (
    <main>
      <h1>Canvas React Bundle</h1>
      <p>Demo data only. No network calls — everything below is baked in.</p>
      <p>{ready ? 'Bridge: ready — live data available.' : 'Bridge: not available — showing demo data.'}</p>
      <Card title="Live docs via the bridge">
        <p>Calls the registered riskhub API through window.canvas — never a direct fetch.</p>
        <Button onClick={loadLiveDocs} disabled={!ready || liveLoading}>
          {liveLoading ? 'Loading…' : 'Load live docs'}
        </Button>
        {liveDocs ? (
          <p>Live docs: {liveDocs.documents.length} — {liveDocs.documents.map((d) => d.title).join(', ')}</p>
        ) : null}
        {liveError ? <p>Live docs failed: {liveError}</p> : null}
      </Card>
      <div className="stats">
        <Stat label="Pages published" value="12" icon={<Layers size={16} />} />
        <Stat label="Versions" value="48" icon={<ShieldCheck size={16} />} />
      </div>
      <Card title="Audit Evidence Pack">
        <p>Immutable versions, hash-chained audit log.</p>
        <Button onClick={() => setOpened(true)}>Open pack</Button>
        {opened ? <p>Pack opened.</p> : null}
      </Card>
    </main>
  )
}
