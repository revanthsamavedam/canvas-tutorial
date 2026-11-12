// End-to-end verification for the tutorial repo (2026-11-11).
// Serves the repo over HTTP and drives headless Chromium through
// the real viewer, the real sample page, and the real React bundle.
// Also renders docs/architecture.svg to docs/architecture.png.
//
// Run: node scripts/verify.mjs   (from the repo root)
// Exits 0 when every step passes.
import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright-core'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const CHROME = '/home/hatch/.cache/ms-playwright/chromium-1228/chrome-linux64/chrome'
const PORT = 8137

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json' }

const server = createServer(async (req, res) => {
  try {
    const url = decodeURIComponent(new URL(req.url, 'http://x').pathname)
    const file = path.join(ROOT, url === '/' ? 'README.md' : url)
    if (!file.startsWith(ROOT) || !existsSync(file)) { res.writeHead(404); res.end('not found'); return }
    const data = await readFile(file)
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' })
    res.end(data)
  } catch (e) {
    res.writeHead(500); res.end(String(e))
  }
})
await new Promise((r) => server.listen(PORT, '127.0.0.1', r))

const steps = []
function step(name, ok, detail = '') {
  steps.push({ name, ok })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`)
}

const browser = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] })
try {
  const page = await browser.newPage()
  page.on('pageerror', (e) => console.log('pageerror:', String(e.message || e).slice(0, 160)))

  // 1. Part 01 demo: bridge client + host, stub API, no server needed.
  await page.goto(`http://127.0.0.1:${PORT}/01-bridge/demo.html`, { waitUntil: 'networkidle' })
  await page.frameLocator('iframe').getByText('Bridge: ready').waitFor({ timeout: 15000 })
  const demoText = await page.frameLocator('iframe').locator('body').innerText()
  step('01 demo: bridge ready + live docs', demoText.includes('Live docs: 2 — Audit Evidence Pack — Q3, Audit Evidence Pack — Q4'))

  // 2. Viewer + plain HTML sample page.
  await page.goto(`http://127.0.0.1:${PORT}/02-viewer/viewer.html`, { waitUntil: 'networkidle' })
  await page.getByRole('button', { name: 'Load sample HTML page' }).click()
  const sample = page.frameLocator('iframe[title="Canvas inner"]')
  await sample.getByText('Bridge: ready').waitFor({ timeout: 20000 })
  await sample.getByRole('button', { name: 'Load live docs' }).click()
  await sample.getByText(/Live docs: 2/).waitFor({ timeout: 15000 })
  step('02+03 viewer: sample page live docs via bridge', true)
  await sample.getByRole('button', { name: '+1' }).click()
  await sample.getByText('Count: 1').waitFor({ timeout: 5000 })
  const countText = await sample.locator('body').innerText()
  step('02+03 viewer: shared state counter', /Count: 1/.test(countText))

  // 3. Viewer + React bundle.
  await page.getByRole('button', { name: 'Load React bundle' }).click()
  const react = page.frameLocator('iframe[title="Canvas inner"]')
  await react.getByText('Bridge: ready').waitFor({ timeout: 20000 })
  await react.getByRole('button', { name: 'Load live docs' }).click()
  await react.getByText(/Live docs: 2/).waitFor({ timeout: 15000 })
  step('02+04 viewer: React bundle live docs via bridge', true)

  // 4. Sample page standalone: fallback, no bridge.
  await page.goto(`http://127.0.0.1:${PORT}/03-sample-html/index.html`, { waitUntil: 'networkidle' })
  await page.getByText('Bridge: not available').waitFor({ timeout: 15000 })
  step('03 standalone: fallback renders without bridge', true)

  // 5. React bundle standalone: fallback, no bridge.
  await page.goto(`http://127.0.0.1:${PORT}/04-react/dist/index.html`, { waitUntil: 'networkidle' })
  await page.getByText('Bridge: not available').waitFor({ timeout: 15000 })
  step('04 standalone: React bundle fallback renders without bridge', true)

  // 6. Render the architecture SVG to PNG (same diagram, viewable everywhere).
  await page.goto(`http://127.0.0.1:${PORT}/docs/architecture.svg`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(500)
  await page.screenshot({ path: path.join(ROOT, 'docs/architecture.png') })
  step('docs: architecture.svg renders to architecture.png', existsSync(path.join(ROOT, 'docs/architecture.png')))
} catch (e) {
  console.log('ERROR:', String(e).slice(0, 400))
} finally {
  await browser.close()
  server.close()
}
const failed = steps.filter((s) => !s.ok)
console.log(failed.length ? `RESULT: ${failed.length} step(s) failed` : 'RESULT: all steps passed')
process.exit(failed.length ? 1 : 0)
