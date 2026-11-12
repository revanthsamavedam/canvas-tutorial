// Generates docs/architecture.excalidraw and docs/architecture.svg
// from one layout, so the two can never drift apart.
// Run: node scripts/gen-diagram.mjs
import { writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const OUT = path.resolve(__dirname, '../docs')

let seed = 1000
const nextSeed = () => (seed += 7)
let nonce = 5000
const nextNonce = () => (nonce += 13)

// ---- layout: boxes {id, x, y, w, h, fill, lines: [text lines], font} ----
const BOXES = [
  { id: 'outer', x: 20, y: 70, w: 900, h: 520, fill: '#f1f3f5', lines: [], font: 16 },
  { id: 'inner', x: 40, y: 120, w: 320, h: 440, fill: '#fff4e6', lines: [], font: 16 },
  { id: 'csp', x: 60, y: 170, w: 280, h: 55, fill: '#ffffff', lines: ["CSP — connect-src 'none'", '(no network)'], font: 16 },
  { id: 'lockdown', x: 60, y: 245, w: 280, h: 55, fill: '#ffffff', lines: ['Lockdown script', 'fetch / XHR throw'], font: 16 },
  { id: 'bridge', x: 60, y: 320, w: 280, h: 55, fill: '#ffffff', lines: ['Bridge script — window.canvas', '(injected at view time)'], font: 16 },
  { id: 'page', x: 60, y: 395, w: 280, h: 130, fill: '#d3f9d8', lines: ['Page — plain HTML sample /', 'React bundle', 'renders · checks ready · calls api.fetch', 'falls back to baked-in data'], font: 16 },
  { id: 'host', x: 420, y: 300, w: 230, h: 100, fill: '#ffffff', lines: ['Bridge host', 'answers canvas-request', 'checks session, dispatches', 'api / state / files'], font: 16 },
  { id: 'registry', x: 420, y: 440, w: 230, h: 80, fill: '#ffffff', lines: ['Registry lookup', 'riskhub → token URL + API URL'], font: 16 },
  { id: 'token', x: 700, y: 300, w: 200, h: 100, fill: '#ffffff', lines: ['Token fetch', 'POST token URL', 'holds the token'], font: 16 },
  { id: 'apicall', x: 700, y: 440, w: 200, h: 80, fill: '#ffffff', lines: ['API call', 'GET / POST + Bearer token'], font: 16 },
  { id: 'riskhub', x: 1020, y: 300, w: 200, h: 170, fill: '#e7f5ff', lines: ['REGISTERED API', 'riskhub (stub)', 'token URL + API URL', 'reached only by', 'the outer shell'], font: 16 },
  { id: 'note', x: 20, y: 620, w: 1180, h: 70, fill: '#fff3bf', lines: ['The page never holds a token and never fetches directly.', "CSP connect-src 'none' + the lockdown script block it at the browser level. Only the outer shell talks to the network."], font: 16 },
]

// standalone labels: {x, y, text, size}
const LABELS = [
  { x: 20, y: 20, text: 'Canvas architecture — the bridge, the shells, and the data flow', size: 24 },
  { x: 40, y: 88, text: 'OUTER SHELL — viewer chrome', size: 16 },
  { x: 60, y: 138, text: 'INNER SHELL — sandboxed iframe', size: 16 },
  { x: 210, y: 368, text: '1 · api.fetch', size: 14 },
  { x: 295, y: 318, text: '2 · canvas-request / 6 · response', size: 14 },
  { x: 545, y: 412, text: '3 · look up', size: 14 },
  { x: 682, y: 405, text: '4 · token URL', size: 14 },
  { x: 810, y: 412, text: 'token', size: 14 },
  { x: 930, y: 492, text: '5 · API request + {status, data}', size: 14 },
]

// arrows: {id, points: [[x,y],...] absolute, from, to, double}
const ARROWS = [
  { id: 'a1', points: [[200, 395], [200, 375]], from: 'page', to: 'bridge', double: false },
  { id: 'a2', points: [[340, 348], [420, 350]], from: 'bridge', to: 'host', double: true },
  { id: 'a3', points: [[535, 400], [535, 440]], from: 'host', to: 'registry', double: false },
  { id: 'a4', points: [[650, 480], [675, 480], [675, 350], [700, 350]], from: 'registry', to: 'token', double: false },
  { id: 'a5', points: [[800, 400], [800, 440]], from: 'token', to: 'apicall', double: false },
  { id: 'a6', points: [[900, 480], [1020, 385]], from: 'apicall', to: 'riskhub', double: true },
]

const byId = Object.fromEntries(BOXES.map((b) => [b.id, b]))
const bound = {} // box id -> [arrow ids]
for (const a of ARROWS) {
  ;(bound[a.from] = bound[a.from] || []).push(a.id)
  ;(bound[a.to] = bound[a.to] || []).push(a.id)
}

// ---- Excalidraw JSON ----
const elements = []
for (const b of BOXES) {
  elements.push({
    id: b.id, type: 'rectangle', x: b.x, y: b.y, width: b.w, height: b.h, angle: 0,
    strokeColor: '#1e1e1e', backgroundColor: b.fill, fillStyle: 'solid', strokeWidth: 2,
    strokeStyle: 'solid', roughness: 1, opacity: 100, groupIds: [], frameId: null,
    roundness: { type: 3 }, seed: nextSeed(), version: 1, versionNonce: nextNonce(),
    isDeleted: false,
    boundElements: (bound[b.id] || []).map((id) => ({ id, type: 'arrow' })),
    updated: 1, link: null, locked: false,
  })
  if (b.lines.length) {
    const lineH = b.font * 1.25
    const textH = b.lines.length * lineH
    elements.push({
      id: b.id + '-label', type: 'text', x: b.x, y: b.y + (b.h - textH) / 2,
      width: b.w, height: textH, angle: 0, strokeColor: '#1e1e1e',
      backgroundColor: 'transparent', fillStyle: 'solid', strokeWidth: 2,
      strokeStyle: 'solid', roughness: 1, opacity: 100, groupIds: [], frameId: null,
      roundness: null, seed: nextSeed(), version: 1, versionNonce: nextNonce(),
      isDeleted: false, boundElements: null, updated: 1, link: null, locked: false,
      text: b.lines.join('\n'), fontSize: b.font, fontFamily: 1, textAlign: 'center',
      verticalAlign: 'top', baseline: textH - 4, containerId: null,
      originalText: b.lines.join('\n'), autoResize: true, lineHeight: 1.25,
    })
  }
}
for (const l of LABELS) {
  elements.push({
    id: 'label-' + l.text.slice(0, 12).replace(/[^a-z0-9]+/gi, '-'),
    type: 'text', x: l.x, y: l.y, width: l.text.length * l.size * 0.55,
    height: l.size * 1.25, angle: 0, strokeColor: '#1e1e1e', backgroundColor: 'transparent',
    fillStyle: 'solid', strokeWidth: 2, strokeStyle: 'solid', roughness: 1, opacity: 100,
    groupIds: [], frameId: null, roundness: null, seed: nextSeed(), version: 1,
    versionNonce: nextNonce(), isDeleted: false, boundElements: null, updated: 1,
    link: null, locked: false, text: l.text, fontSize: l.size, fontFamily: 1,
    textAlign: 'left', verticalAlign: 'top', baseline: l.size, containerId: null,
    originalText: l.text, autoResize: true, lineHeight: 1.25,
  })
}
for (const a of ARROWS) {
  const [x0, y0] = a.points[0]
  const pts = a.points.map(([x, y]) => [x - x0, y - y0])
  const xs = a.points.map((p) => p[0]), ys = a.points.map((p) => p[1])
  elements.push({
    id: a.id, type: 'arrow', x: x0, y: y0,
    width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys),
    angle: 0, strokeColor: '#1e1e1e', backgroundColor: 'transparent', fillStyle: 'solid',
    strokeWidth: 2, strokeStyle: 'solid', roughness: 1, opacity: 100, groupIds: [],
    frameId: null, roundness: { type: 2 }, seed: nextSeed(), version: 1,
    versionNonce: nextNonce(), isDeleted: false, boundElements: null, updated: 1,
    link: null, locked: false, points: pts, lastCommittedPoint: null,
    startBinding: { elementId: a.from, focus: 0, gap: 1 },
    endBinding: { elementId: a.to, focus: 0, gap: 1 },
    startArrowhead: a.double ? 'arrow' : null, endArrowhead: 'arrow',
  })
}

const excalidraw = {
  type: 'excalidraw', version: 2, source: 'canvas-tutorial',
  elements, appState: { gridSize: null, viewBackgroundColor: '#ffffff' }, files: {},
}
writeFileSync(path.join(OUT, 'architecture.excalidraw'), JSON.stringify(excalidraw, null, 2) + '\n')

// ---- SVG render (same layout, same text) ----
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1260" height="720" viewBox="0 0 1260 720" font-family="Segoe Print, Comic Sans MS, cursive, sans-serif">\n`
svg += `<defs><marker id="arr" markerWidth="10" markerHeight="8" refX="8" refY="4" orient="auto"><path d="M0,0 L10,4 L0,8 z" fill="#1e1e1e"/></marker></defs>\n`
svg += `<rect x="0" y="0" width="1260" height="720" fill="#ffffff"/>\n`
for (const b of BOXES) {
  svg += `<rect x="${b.x}" y="${b.y}" width="${b.w}" height="${b.h}" rx="6" fill="${b.fill}" stroke="#1e1e1e" stroke-width="2"/>\n`
  if (b.lines.length) {
    const lineH = b.font * 1.25
    const textH = b.lines.length * lineH
    const y0 = b.y + (b.h - textH) / 2 + b.font
    svg += `<text x="${b.x + b.w / 2}" y="${y0}" font-size="${b.font}" text-anchor="middle" fill="#1e1e1e">`
    svg += b.lines.map((ln, i) => `<tspan x="${b.x + b.w / 2}" dy="${i === 0 ? 0 : lineH}">${esc(ln)}</tspan>`).join('')
    svg += `</text>\n`
  }
}
for (const a of ARROWS) {
  const d = a.points.map(([x, y], i) => (i === 0 ? `M${x},${y}` : `L${x},${y}`)).join(' ')
  const head = a.double ? ' marker-start="url(#arr)"' : ''
  svg += `<path d="${d}" fill="none" stroke="#1e1e1e" stroke-width="2" marker-end="url(#arr)"${head}/>\n`
}
for (const l of LABELS) {
  svg += `<text x="${l.x}" y="${l.y + l.size}" font-size="${l.size}" fill="#1e1e1e">${esc(l.text)}</text>\n`
}
svg += `</svg>\n`
writeFileSync(path.join(OUT, 'architecture.svg'), svg)
console.log('wrote docs/architecture.excalidraw and docs/architecture.svg')
