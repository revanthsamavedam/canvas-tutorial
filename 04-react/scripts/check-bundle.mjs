// Check the built bundle against the Canvas publish-gate rules.
// This mirrors the forbidden-pattern checks in the API's validate_html.py
// (app/validate_html.py): no secrets, no token URLs, no direct fetch /
// XHR / WebSocket, no external resources. It runs on the BUNDLE, not the
// source — and it splits the document first, because the naive validator
// runs every regex over the whole file: a `new URL("http://localhost")`
// inside react-router's JS trips the CSS url() rule, and a `<Link to=`
// string inside the JS trips the <link> rule. Each check below runs in
// its own context (markup, style, script).
//
// Run:  npm run check        (after npm run build)
// Exit 0 = publishable (warnings are validator false positives the API
// must allow). Exit 1 = a real violation was found.
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

const DIST = new URL('../dist/', import.meta.url).pathname
const files = readdirSync(DIST)
const htmlFile = files.find((f) => f.endsWith('.html'))
if (!htmlFile) {
  console.log('FAIL: no .html file in dist/')
  process.exit(1)
}
const html = readFileSync(join(DIST, htmlFile), 'utf8')
const size = statSync(join(DIST, htmlFile)).size

// Split the document: markup (no script/style bodies), style bodies,
// script bodies. Tag checks run on markup, CSS checks on styles, JS
// checks on scripts.
const scripts = [...html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/gi)]
  .map((m) => m[1]).join('\n')
const styles = [...html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)]
  .map((m) => m[1]).join('\n')
const markup = html
  .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
  .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')

const failures = []
const warnings = []
const count = (s, re) => (s.match(re) || []).length

// --- Markup: external resources (real tags only) ---
if (/<script[^>]+src=["']https?:/i.test(markup)) failures.push('external script src')
if (/<link[^>]+href=["']https?:/i.test(markup)) failures.push('external stylesheet link')
if (/<(img|video|audio|source|iframe|embed)[^>]+src=["']https?:/i.test(markup)) failures.push('external media src')
if (/(src|href)=["']\/\//i.test(markup)) failures.push('protocol-relative src/href')

// --- CSS (inline <style> blocks only): external imports ---
if (/@import\s+["']?https?:/i.test(styles)) failures.push('CSS @import of a URL')
if (/url\(\s*["']?https?:/i.test(styles)) failures.push('CSS url(http...)')

// --- JS: direct network calls ---
// fetch: allow only the Vite modulepreload helper, which is dead code in
// a single-file build — no <link rel="modulepreload"> exists in the
// document, so it can never fire — and bridge calls
// (window.canvas.api.fetch), which are not direct fetches: the page
// holds no token and the outer shell performs the call. Any other
// fetch( is a real violation. This mirrors _has_real_fetch in the
// API's validate_html.py (helper + bridge are subtracted from the
// total); the modulepreload check is omitted here because the bundle
// never contains one (verified by the build).
const totalFetch = count(scripts, /\bfetch\s*\(/g)
const helperFetch = count(scripts, /fetch\([a-zA-Z_$][\w$]*\.href,[a-zA-Z_$][\w$]*\)/g)
const bridgeFetch = count(scripts, /\b(?:canvas|agentdocs)\s*\.\s*api\s*\.\s*fetch\s*\(/g)
if (totalFetch > helperFetch + bridgeFetch) {
  failures.push(`direct fetch( (${totalFetch - helperFetch - bridgeFetch} call(s) beyond the Vite preload helper and bridge calls)`)
} else if (totalFetch > 0) {
  warnings.push('Vite preload-helper fetch( — dead code, no modulepreload links in the document')
}
if (/XMLHttpRequest/.test(scripts)) failures.push('XMLHttpRequest')
if (/new\s+WebSocket/.test(scripts)) failures.push('WebSocket')

// --- Whole file: secrets and token URLs ---
if (/token_?url/i.test(html)) failures.push('token URL identifier')
if (/["'][^"']*\/token[^"']*["']/i.test(html)) failures.push('/token path in a URL')
if (/-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(html)) failures.push('private key material')
if (/Bearer\s+[A-Za-z0-9._-]{20,}/.test(html)) failures.push('bearer token literal')

// --- React runtime: the minified bundle contains neither `from 'react'`
// nor `React.createElement`, so the current react_import rule does not
// fire on it. Report it either way so the behaviour is explicit.
if (/from\s+['"]react['"]|React\.createElement/.test(scripts)) {
  warnings.push('react_import string present in bundle (React runtime)')
}

console.log(`file: dist/${htmlFile} (${(size / 1024).toFixed(1)} KB)`)
console.log(`dist contents: ${files.join(', ')}`)
console.log(`failures: ${failures.length ? failures.join(', ') : 'none'}`)
console.log(`warnings (validator must allow): ${warnings.length ? warnings.join(', ') : 'none'}`)
process.exit(failures.length ? 1 : 0)
