#!/usr/bin/env node
// Static audit of the BUILT app (dist/): what could it contact, what Chinese is left, any AI.
//   npm run build && node audit/static.mjs
// Prints every finding with context, then a verdict. Exit code 1 if something fails.
import fs from 'node:fs'
import path from 'node:path'

const DIST = path.resolve(process.argv[2] || 'dist')
const files = []
const walk = d => fs.readdirSync(d, { withFileTypes: true }).forEach(e => {
  const p = path.join(d, e.name)
  if (e.isDirectory()) walk(p)
  else if (/\.(js|css|html|json|svg)$/.test(e.name)) files.push(p)
})
walk(DIST)
const ctx = (t, i, n = 70) => t.slice(Math.max(0, i - n), i + n).replace(/\s+/g, ' ')
let fail = 0
const head = s => console.log(`\n== ${s}`)

// 1. Hosts named anywhere in the bundle. XML/SVG namespaces and licence/doc links are
// identifiers, never fetched; everything else is shown with its context to judge.
const NAMESPACE = /^(www\.w3\.org|schemas\.openxmlformats\.org|schemas\.microsoft\.com|purl\.org|ns\.adobe\.com|www\.idpf\.org|xmlns\.com|docs\.oasis-open\.org)$/
// Reviewed, never fetched: licence banners and documentation links inside libraries' error
// messages, the placeholder in the media dialog, and links a user can click (this fork's
// repo and issues). A host not in either list fails the audit until someone looks at it.
const REVIEWED = {
  'animate.style': 'licence banner', 'clipboardjs.com': 'licence banner', 'lodash.com': 'licence banner',
  'openjsf.org': 'licence banner', 'opensource.org': 'licence banner', 'underscorejs.org': 'licence banner',
  'stuartk.com': 'licence banner', 'raw.github.com': 'licence banner',
  'bit.ly': 'Dexie error message', 'tinyurl.com': 'Dexie error message', 'npms.io': 'lodash error message',
  'gitbrent.github.io': 'PptxGenJS error message', 'stuk.github.io': 'JSZip error message',
  'prosemirror.net': 'ProseMirror error message', 'vuejs.org': 'Vue error message',
  'github.com': 'this fork\'s repo/issues links (clicked by the user), library LICENSE links, a PptxGenJS error message',
  'xxx.mp': 'placeholder text: e.g. https://xxx.mp4',
}
head('hosts named in the bundle')
const hosts = {}
for (const f of files) {
  const t = fs.readFileSync(f, 'utf8')
  for (const m of t.matchAll(/(?:https?|wss?):\/\/([a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/g)) {
    (hosts[m[1]] ||= []).push(`${path.relative(DIST, f)}: …${ctx(t, m.index)}…`)
  }
}
for (const [h, where] of Object.entries(hosts).sort()) {
  const ns = NAMESPACE.test(h), why = REVIEWED[h]
  console.log(`${ns ? '  ns  ' : why ? '  ok  ' : '  FAIL'} ${h}  (${where.length}x)${ns ? '  XML namespace' : why ? '  ' + why : ''}`)
  if (!ns && !why) { where.slice(0, 3).forEach(w => console.log('       ' + w)); fail++ }
  if (h === 'github.com') {
    const other = where.filter(w => /github\.com\/(?!alcaann\/PPTist-International)[A-Za-z]/.test(w) && !/hyperlink|\/LICENSE/.test(w))
    if (other.length) { other.forEach(w => console.log('  FAIL github link outside this fork: ' + w)); fail += other.length }
  }
}

// 2. Network call sites. Any of these is fine only if what it loads is relative/same-origin,
// which the CSP enforces at run time; listed so a reader can check.
head('network call sites (fetch / XHR / WebSocket / beacons / workers)')
const CALLS = /\bfetch\(|XMLHttpRequest|new WebSocket|new EventSource|sendBeacon|importScripts\(|new Worker\(|navigator\.connection/g
for (const f of files.filter(f => f.endsWith('.js'))) {
  const t = fs.readFileSync(f, 'utf8')
  const hits = [...t.matchAll(CALLS)]
  if (hits.length) console.log(`  ${path.relative(DIST, f)}: ${hits.length} — ` +
    Object.entries(hits.reduce((a, m) => (a[m[0]] = (a[m[0]] || 0) + 1, a), {})).map(([k, v]) => `${k} ${v}`).join(', '))
}

// 3. The policy itself.
head('Content-Security-Policy in index.html')
const html = fs.readFileSync(path.join(DIST, 'index.html'), 'utf8')
const csp = (html.match(/http-equiv="Content-Security-Policy" content="([^"]+)"/) || [])[1]
if (!csp) { console.log('  MISSING'); fail++ }
else {
  console.log('  ' + csp)
  for (const d of ['default-src', 'connect-src', 'img-src', 'font-src', 'script-src', 'style-src', 'media-src']) {
    const v = (csp.match(new RegExp(`${d} ([^;]+)`)) || [])[1] || ''
    if (/https?:|\*/.test(v)) { console.log(`  FAIL: ${d} allows remote sources: ${v}`); fail++ }
  }
}

// 4. Known third-party endpoints and AI vocabulary.
head('third-party endpoints / AI features')
const BAD = /server\.pptist\.cn|pexels\.com|freesound\.org|fonts\.googleapis|fonts\.gstatic|AIPPT|aippt|ai_writing|AI_Writing|img_search|openai|deepseek|doubao|qwen|glm-|moonshot|anthropic/gi
for (const f of files) {
  const t = fs.readFileSync(f, 'utf8')
  for (const m of t.matchAll(BAD)) { console.log(`  FAIL ${path.relative(DIST, f)}: …${ctx(t, m.index)}…`); fail++ }
}

// 5. Chinese left in the bundle. Three kinds are expected and allowed; anything else fails:
//  - ECharts' built-in zh locale (echarts/core registers it; charts here use locale EN)
//  - measureText("国"): the text layout measures one wide glyph, never shown
//  - typeface="…" in the Office theme XML that pptxgenjs writes into exported .pptx files
head('Chinese text left in the bundle')
const CJK = /[\u4e00-\u9fff][\u4e00-\u9fff\u3000-\u303f\uff00-\uffef]*/g
for (const f of files) {
  const t = fs.readFileSync(f, 'utf8')
  const a = t.indexOf('month:["一月"'), b = a < 0 ? -1 : t.indexOf('withoutName:"{value}"', a)
  const kinds = {}
  for (const m of t.matchAll(CJK)) {
    const near = t.slice(Math.max(0, m.index - 40), m.index + m[0].length + 2)
    const kind = (a >= 0 && m.index > a && m.index < b) ? 'ECharts zh locale (unused)'
      : /measureText\("$/.test(t.slice(m.index - 13, m.index)) ? 'measureText glyph'
      : /typeface="$/.test(t.slice(m.index - 10, m.index)) ? 'Office theme font name in .pptx export'
      : null
    if (!kind) { console.log(`  FAIL ${path.relative(DIST, f)}: ${m[0]}  …${ctx(t, m.index, 50)}…`); fail++; continue }
    kinds[kind] = (kinds[kind] || 0) + 1
  }
  for (const [k, n] of Object.entries(kinds)) console.log(`  ok  ${path.relative(DIST, f)}: ${n} × ${k}`)
}

console.log(`\n${fail ? 'FAIL' : 'PASS'}: ${fail} failing finding(s)`)
process.exit(fail ? 1 : 0)
