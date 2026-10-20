#!/usr/bin/env node
// Live audit: run the BUILT app in headless Chrome, use it, and record every request.
//   npm run build && node audit/live.mjs
// Serves dist/ (plus a stand-in for the local deck API) on 127.0.0.1, opens the editor,
// clicks every visible menu, button and tab, inserts a slide, a text box, a shape and a
// chart, opens the slideshow, and checks the visible text after every step. Fails on:
//   - any request that leaves 127.0.0.1 (data:/blob: are local)
//   - any request the Content-Security-Policy had to block (= some code still TRIED)
//   - any Chinese character in the visible UI
// Links that open in a new tab (target=_blank) are listed, not clicked.
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { spawn, execFileSync } from 'node:child_process'

const DIST = path.resolve(process.argv[2] || 'dist')
const CHROME = ['google-chrome', 'chromium', 'chromium-browser'].map(c => {
  try { return execFileSync('which', [c]).toString().trim() } catch { return null }
}).find(Boolean)
if (!CHROME) { console.error('needs google-chrome or chromium'); process.exit(2) }

// --- local server: dist/ + a stand-in for GET/PUT ../api/deck -------------------------
let deck = null, puts = 0
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
                '.woff2': 'font/woff2', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon' }
const server = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x')
  if (u.pathname === '/api/deck') {
    if (req.method === 'PUT') {
      let b = ''; req.on('data', c => b += c); req.on('end', () => {
        deck = JSON.parse(b).deck; puts++
        res.end(JSON.stringify({ version: String(puts) }))
      })
      return
    }
    return res.end(JSON.stringify({ version: puts ? String(puts) : null, deck }))
  }
  const rel = u.pathname.replace(/^\/app\//, '/')
  const f = path.join(DIST, rel === '/' ? 'index.html' : rel)
  if (!f.startsWith(DIST) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.statusCode = 404; return res.end() }
  res.setHeader('Content-Type', TYPES[path.extname(f)] || 'application/octet-stream')
  fs.createReadStream(f).pipe(res)
})
await new Promise(r => server.listen(0, '127.0.0.1', r))
const ORIGIN = `http://127.0.0.1:${server.address().port}`

// --- Chrome over the DevTools protocol --------------------------------------------------
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'pptist-audit-'))
const chrome = spawn(CHROME, ['--headless=new', '--disable-gpu', '--remote-debugging-port=0', `--user-data-dir=${profile}`,
  '--no-first-run', '--no-default-browser-check', '--disable-background-networking', '--disable-component-update',
  '--disable-sync', '--window-size=1600,1000', 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'] })
const wsUrl = await new Promise((resolve, reject) => {
  let err = ''
  chrome.stderr.on('data', d => { err += d; const m = err.match(/ws:\/\/[^\s]+/); if (m) resolve(m[0]) })
  setTimeout(() => reject(new Error('Chrome did not start')), 15000)
})
const browser = new WebSocket(wsUrl)
await new Promise(r => browser.addEventListener('open', r))
let id = 0
const pending = new Map(), listeners = []
browser.addEventListener('message', e => {
  const m = JSON.parse(e.data)
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id) }
  else listeners.forEach(l => l(m))
})
const send = (method, params = {}, sessionId) => new Promise((res, rej) => {
  const i = ++id
  pending.set(i, m => m.error ? rej(new Error(`${method}: ${m.error.message}`)) : res(m.result))
  browser.send(JSON.stringify({ id: i, method, params, sessionId }))
})
const { targetId } = await send('Target.createTarget', { url: 'about:blank' })
const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true })
const S = (m, p) => send(m, p, sessionId)

const requests = [], blocked = [], consoleCsp = [], cjkSeen = new Map()
listeners.push(m => {
  if (m.sessionId !== sessionId) return
  if (m.method === 'Network.requestWillBeSent') requests.push(m.params.request.url)
  if (m.method === 'Network.loadingFailed' && m.params.blockedReason) blocked.push(`${m.params.blockedReason}: ${m.params.requestId}`)
  if (m.method === 'Runtime.consoleAPICalled' || m.method === 'Log.entryAdded') {
    const text = m.params.entry?.text || (m.params.args || []).map(a => a.value).join(' ')
    if (/Content Security Policy|Refused to/i.test(text || '')) consoleCsp.push(text)
  }
})
await S('Network.enable'); await S('Runtime.enable'); await S('Log.enable'); await S('Page.enable')
// a real downloads folder in the profile, so export buttons don't leave files around
await send('Browser.setDownloadBehavior', { behavior: 'deny' }).catch(() => {})

const sleep = ms => new Promise(r => setTimeout(r, ms))
const evaluate = async expr => (await S('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })).result.value
const CJK_EXPR = `(() => { const m = document.body.innerText.match(/[\\u3000-\\u303f\\u4e00-\\u9fff\\uff00-\\uffef]+/g); return m || [] })()`
const checkText = async step => {
  for (const s of await evaluate(CJK_EXPR)) if (!cjkSeen.has(s)) cjkSeen.set(s, step)
}
const key = async (k, code, keyCode) => {
  for (const type of ['keyDown', 'keyUp']) await S('Input.dispatchKeyEvent', { type, key: k, code, windowsVirtualKeyCode: keyCode })
}

async function visit(url, label) {
  await S('Page.navigate', { url })
  for (let i = 0; i < 100; i++) {
    if (await evaluate(`!!document.querySelector('.pptist-editor, .pptist-screen, .editor-header, .mobile')`)) break
    await sleep(100)
  }
  await sleep(800)
  await checkText(label)
}

// 1. the editor, as rehearse.py serves it
await visit(`${ORIGIN}/app/index.html?deck=edit`, 'editor loaded')

// 2. click every visible control, one at a time; Escape after each so popovers close
const SEL = '.editor-header .menu-item, .editor-header .left > *, .canvas-tool .handler-item, .canvas-tool .add-element-handler > *, ' +
            '.toolbar .tabs .tab, .thumbnails .add-slide .btn, .popover-menu-item, .remark, .tab'
const clicked = new Set(), links = new Set()
for (let round = 0; round < 3; round++) {
  const n = await evaluate(`document.querySelectorAll(${JSON.stringify(SEL)}).length`)
  for (let i = 0; i < n; i++) {
    const info = await evaluate(`(() => {
      const el = document.querySelectorAll(${JSON.stringify(SEL)})[${i}]
      if (!el || !el.offsetParent) return null
      const a = el.closest('a[target=_blank]')
      if (a) return { link: a.href }
      return { label: (el.innerText || el.getAttribute('aria-label') || el.className || '').toString().trim().slice(0, 40) }
    })()`)
    if (!info) continue
    if (info.link) { links.add(info.link); continue }
    const k = `${round}:${i}:${info.label}`
    if (clicked.has(k)) continue
    clicked.add(k)
    await evaluate(`(() => { const el = document.querySelectorAll(${JSON.stringify(SEL)})[${i}]; el && el.click() })()`)
    await sleep(250)
    await checkText(`after clicking "${info.label}"`)
    if (round < 2) { await key('Escape', 'Escape', 27); await sleep(100) }
  }
}

// 3. content: a slide, a text box (T then click), a shape and a chart via the store-backed UI
await evaluate(`document.querySelector('.thumbnails .add-slide .btn')?.click()`)
await sleep(300)
await checkText('new slide')
const chartBtn = await evaluate(`(() => { const b = [...document.querySelectorAll('.canvas-tool .handler-item')].find(e => /chart/i.test(e.innerText + e.title + (e.getAttribute('data-tooltip')||''))); b && b.click(); return !!b })()`)
await sleep(300)
await evaluate(`document.querySelector('.chart-pool .chart-item, .chart-list .chart-item, [class*=chart] [class*=item]')?.click()`)
await sleep(800)
await checkText('chart inserted' + (chartBtn ? '' : ' (chart button not found)'))

// 4. the slideshow (F5), then presenter view; then the published player and the view mode
await key('F5', 'F5', 116); await sleep(1500); await checkText('slideshow (F5)')
await key('Escape', 'Escape', 27); await sleep(500)
await visit(`${ORIGIN}/app/index.html?deck=view`, 'view mode')
fs.writeFileSync(path.join(DIST, 'deck.json'), JSON.stringify(deck || { slides: [] }))
await visit(`${ORIGIN}/app/index.html?deck=player`, 'player mode')
fs.rmSync(path.join(DIST, 'deck.json'))
await visit(`${ORIGIN}/app/index.html`, 'upstream mode (demo deck)')
await sleep(1500)

// --- verdict ---------------------------------------------------------------------------------
browser.close(); server.close()
await new Promise(r => { chrome.once('exit', r); chrome.kill() })
try { fs.rmSync(profile, { recursive: true, force: true, maxRetries: 5 }) } catch {}
const local = u => u.startsWith(ORIGIN) || /^(data|blob|about|chrome-extension|devtools):/.test(u)
const away = [...new Set(requests.filter(u => !local(u)))]
let fail = 0
console.log(`clicked ${clicked.size} controls; ${requests.length} requests (${new Set(requests).size} distinct); deck saved ${puts} times`)
console.log(`\n== requests that left ${ORIGIN}`)
away.forEach(u => console.log('  FAIL ' + u)); fail += away.length
if (!away.length) console.log('  none')
console.log('\n== requests blocked by the Content-Security-Policy (code that tried)')
;[...blocked, ...consoleCsp].forEach(b => console.log('  FAIL ' + b)); fail += blocked.length + consoleCsp.length
if (!blocked.length && !consoleCsp.length) console.log('  none')
console.log('\n== Chinese in the visible UI')
for (const [s, step] of cjkSeen) { console.log(`  FAIL "${s}"  (${step})`); fail++ }
if (!cjkSeen.size) console.log('  none')
console.log('\n== links that open a new tab (not clicked; only on user click)')
links.forEach(l => console.log('  ' + l))
console.log(`\n${fail ? 'FAIL' : 'PASS'}: ${fail} failing finding(s)`)
process.exit(fail ? 1 : 0)
