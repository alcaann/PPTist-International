#!/usr/bin/env node
// Collaboration test: two editors (?deck=edit) on one deck, in headless Chrome, editing at once.
//   npm run build && node audit/collab.mjs
// Serves dist/ with a deck API that behaves like tools/rehearse.py (GET ?v= answers
// "unchanged", PUT refuses an outdated version with 409), edits through PPTist's own stores,
// and checks that both editors and the saved file end up with everyone's changes, that undo
// takes back only the editor's own change, and that a real conflict is reported.
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import crypto from 'node:crypto'
import { spawn, execFileSync } from 'node:child_process'

const DIST = path.resolve(process.argv[2] || 'dist')
const CHROME = ['google-chrome', 'chromium', 'chromium-browser'].map(c => {
  try { return execFileSync('which', [c]).toString().trim() } catch { return null }
}).find(Boolean)
if (!CHROME) { console.error('needs google-chrome or chromium'); process.exit(2) }

// --- the deck server ------------------------------------------------------------------------
const el = (id, left) => ({ id, type: 'shape', left, top: 100, width: 100, height: 100, rotate: 0,
  viewBox: [200, 200], path: 'M 0 0 L 200 0 L 200 200 L 0 200 Z', fixedRatio: false, fill: '#5b9bd5' })
let deck = { title: 'Collab test', width: 1000, height: 562.5,
  slides: [{ id: 's1', elements: [el('e1', 100), el('e2', 400)] }, { id: 's2', elements: [] }] }
const hash = () => crypto.createHash('sha1').update(JSON.stringify(deck)).digest('hex').slice(0, 16)
let version = hash(), puts = 0, refused = 0
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
                '.woff2': 'font/woff2', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon' }
const server = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x')
  if (u.pathname === '/api/deck') {
    if (req.method === 'PUT') {
      let b = ''; req.on('data', c => b += c); req.on('end', () => {
        const p = JSON.parse(b)
        if (p.version !== version) { refused++; res.statusCode = 409; return res.end(JSON.stringify({ version })) }
        deck = p.deck; version = hash(); puts++
        res.end(JSON.stringify({ version }))
      })
      return
    }
    if (u.searchParams.get('v') === version) return res.end(JSON.stringify({ version, unchanged: true }))
    return res.end(JSON.stringify({ version, deck }))
  }
  const rel = u.pathname.replace(/^\/app\//, '/')
  const f = path.join(DIST, rel === '/' ? 'index.html' : rel)
  if (!f.startsWith(DIST) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.statusCode = 404; return res.end() }
  res.setHeader('Content-Type', TYPES[path.extname(f)] || 'application/octet-stream')
  fs.createReadStream(f).pipe(res)
})
await new Promise(r => server.listen(0, '127.0.0.1', r))
const ORIGIN = `http://127.0.0.1:${server.address().port}`

// --- Chrome over the DevTools protocol ----------------------------------------------------------
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'pptist-collab-'))
const chrome = spawn(CHROME, ['--headless=new', '--disable-gpu', '--remote-debugging-port=0', `--user-data-dir=${profile}`,
  '--no-first-run', '--no-default-browser-check', '--disable-background-networking', '--disable-component-update',
  '--disable-sync', '--disable-background-timer-throttling', '--disable-renderer-backgrounding',
  '--window-size=1600,1000', 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'] })
const wsUrl = await new Promise((resolve, reject) => {
  let err = ''
  chrome.stderr.on('data', d => { err += d; const m = err.match(/ws:\/\/[^\s]+/); if (m) resolve(m[0]) })
  setTimeout(() => reject(new Error('Chrome did not start')), 15000)
})
const browser = new WebSocket(wsUrl)
await new Promise(r => browser.addEventListener('open', r))
let id = 0
const pending = new Map()
browser.addEventListener('message', e => {
  const m = JSON.parse(e.data)
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id) }
})
const send = (method, params = {}, sessionId) => new Promise((res, rej) => {
  const i = ++id
  pending.set(i, m => m.error ? rej(new Error(`${method}: ${m.error.message}`)) : res(m.result))
  browser.send(JSON.stringify({ id: i, method, params, sessionId }))
})
const sleep = ms => new Promise(r => setTimeout(r, ms))

async function editor(name) {      // each editor in its own browser context, like two machines
  const { browserContextId } = await send('Target.createBrowserContext')
  const { targetId } = await send('Target.createTarget', { url: 'about:blank', browserContextId })
  const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true })
  const S = (m, p) => send(m, p, sessionId)
  await S('Runtime.enable'); await S('Page.enable')
  const run = async expr => {
    const r = await S('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })
    if (r.exceptionDetails) throw new Error(`${name}: ${r.exceptionDetails.exception?.description || r.exceptionDetails.text}`)
    return r.result.value
  }
  await S('Page.navigate', { url: `${ORIGIN}/app/index.html?deck=edit` })
  for (let i = 0; i < 100 && !(await run(`!!document.querySelector('.pptist-editor')`)); i++) await sleep(100)
  await sleep(1000)
  // PPTist's own stores, as the UI uses them
  await run(`window.__s = n => document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get(n); 1`)
  return { name, run }
}
const shape = (d, sid, eid) => d.slides.find(s => s.id === sid)?.elements.find(e => e.id === eid)
const left = async (ed, sid, eid) => ed.run(`(() => {
  const s = __s('slides').slides.find(s => s.id === ${JSON.stringify(sid)})
  return s?.elements.find(e => e.id === ${JSON.stringify(eid)})?.left ?? null })()`)
const ids = async ed => ed.run(`__s('slides').slides.map(s => s.id)`)
const toasts = async ed => ed.run(`[...document.querySelectorAll('.message .description')].map(e => e.innerText).join(' | ')`)

const A = await editor('A'), B = await editor('B')
const results = []
const check = (what, ok, detail = '') => { results.push(ok); console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${what}${detail ? '  (' + detail + ')' : ''}`) }
const settle = () => sleep(5000)       // > autosave delay + two polling rounds

console.log('== two editors, different things at once')
await A.run(`__s('slides').updateElement({ id: 'e1', slideId: 's1', props: { left: 150 } }); 1`)
await B.run(`__s('slides').addSlide({ id: 'sB', elements: [] }); 1`)
await settle()
check('A sees B\'s new slide', (await ids(A)).includes('sB'), (await ids(A)).join(','))
check('B sees A\'s moved shape', await left(B, 's1', 'e1') === 150, String(await left(B, 's1', 'e1')))
check('the file has both', deck.slides.some(s => s.id === 'sB') && shape(deck, 's1', 'e1')?.left === 150)

console.log('== same slide, different shapes, at once')
await A.run(`__s('slides').updateElement({ id: 'e1', slideId: 's1', props: { left: 160 } }); 1`)
await B.run(`__s('slides').updateElement({ id: 'e2', slideId: 's1', props: { left: 460 } }); 1`)
await settle()
for (const ed of [A, B]) check(`${ed.name} has both moves`, await left(ed, 's1', 'e1') === 160 && await left(ed, 's1', 'e2') === 460)

console.log('== undo takes back only your own change')
await B.run(`(async () => { await __s('snapshot').addSnapshot(); __s('slides').updateElement({ id: 'e2', slideId: 's1', props: { left: 470 } }); await __s('snapshot').addSnapshot() })()`)
await settle()
await A.run(`__s('slides').updateElement({ id: 'e1', slideId: 's1', props: { left: 170 } }); 1`)
await settle()
check('B received A\'s move before undoing', await left(B, 's1', 'e1') === 170)
await B.run(`__s('snapshot').unDo()`)
await settle()
check('B\'s undo reverted B\'s own move', await left(B, 's1', 'e2') === 460, String(await left(B, 's1', 'e2')))
check('...and kept A\'s move', await left(B, 's1', 'e1') === 170 && await left(A, 's1', 'e1') === 170,
      `B ${await left(B, 's1', 'e1')}, A ${await left(A, 's1', 'e1')}`)

console.log('== a real conflict: the same shape moved by both')
await Promise.all([A.run(`__s('slides').updateElement({ id: 'e1', slideId: 's1', props: { left: 300 } }); 1`),
                   B.run(`__s('slides').updateElement({ id: 'e1', slideId: 's1', props: { left: 333 } }); 1`)])
await settle()
const la = await left(A, 's1', 'e1'), lb = await left(B, 's1', 'e1')
check('both editors agree', la === lb && la === shape(deck, 's1', 'e1')?.left, `A ${la}, B ${lb}, file ${shape(deck, 's1', 'e1')?.left}`)
const [winner, loser] = la === 300 ? [A, B] : [A, B].reverse()
const told = (await toasts(winner)).match(/same thing on slide 1/g) || []
check(`the editor whose version won (${winner.name}) was told, once`, told.length === 1, `${told.length}x`)
check(`the other editor (${loser.name}) was not`, !/same thing/.test(await toasts(loser)))

browser.close(); server.close()
await new Promise(r => { chrome.once('exit', r); chrome.kill() })
try { fs.rmSync(profile, { recursive: true, force: true, maxRetries: 5 }) } catch {}
const fail = results.filter(r => !r).length
console.log(`\n${puts} saves, ${refused} refused as outdated and merged`)
console.log(`${fail ? 'FAIL' : 'PASS'}: ${results.length - fail}/${results.length} checks`)
process.exit(fail ? 1 : 0)
