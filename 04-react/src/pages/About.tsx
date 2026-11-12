import { Card } from '@canvas-lib'

export function About() {
  return (
    <main>
      <h1>About this bundle</h1>
      <Card title="How it was built">
        <p>
          React source plus a pre-existing component library, bundled by Vite
          into one self-contained HTML file.
        </p>
      </Card>
    </main>
  )
}
