// Vite plugin: translate PPTist's Chinese UI at build time, from i18n/<lang>.json.
//   PPTIST_LANG=en (default) npm run build      PPTIST_LANG=zh keeps the original UI
// PPTist's source stays as upstream wrote it, so updating PPTist is a merge and a rebuild;
// `node i18n/extract.mjs . --missing --lang en` then lists any new strings.
// The build fails if a string in src/ has no translation (set PPTIST_I18N_LAX=1 to only warn).
import fs from 'node:fs'
import { RUN, HAS_CJK, stripComments, checkValue } from './cjk.mjs'

export default function pptistEnglish() {
  const lang = process.env.PPTIST_LANG || 'en'
  if (lang === 'zh') return { name: 'pptist-english' }
  const raw = JSON.parse(fs.readFileSync(new URL(`./${lang}.json`, import.meta.url), 'utf8'))
  const whole = Object.entries(raw._whole || {}).sort((a, b) => b[0].length - a[0].length)
  const runs = Object.fromEntries(Object.entries(raw).filter(([k]) => !k.startsWith('_')))
  const bad = [...whole, ...Object.entries(runs)].map(([k, v]) => [k, checkValue(k, v)]).filter(([, e]) => e)
  if (bad.length) throw new Error('en.json: ' + bad.map(([k, e]) => `"${k}": ${e}`).join('; '))

  const missing = new Set()
  // The source is translated as is (comments too, where an entry matches: harmless, the
  // build drops them). Untranslated runs only count when they are outside comments.
  const translate = (code, id) => {
    for (const [k, v] of whole) code = code.split(k).join(v)
    const out = code.replace(RUN, m => runs[m] ?? m)
    for (const m of stripComments(out).match(RUN) || []) missing.add(`${m}  (${id.split('/src/')[1] || id})`)
    return out
  }

  return {
    name: 'pptist-english',
    enforce: 'pre',
    transform(code, id) {
      if (!/\/src\/.*\.(vue|ts|tsx|js)$/.test(id.split('?')[0]) || !HAS_CJK.test(code)) return null
      return { code: translate(code, id), map: null }
    },
    transformIndexHtml(html) {
      // The page may only talk to the server it came from: no CDN, no fonts, no analytics,
      // no cloud API, whatever a future PPTist version adds. Images/media from files the
      // user picks arrive as data:/blob: URLs and still work.
      const csp = "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; " +
                  "img-src 'self' data: blob:; media-src 'self' data: blob:; font-src 'self' data:; " +
                  "connect-src 'self' data: blob:; frame-src 'self'; worker-src 'self' blob:; form-action 'none'"
      const out = translate(html, 'index.html')
      // index.html is transformed after buildEnd, so check it here
      const left = stripComments(out).match(RUN)
      if (left && !process.env.PPTIST_I18N_LAX) throw new Error('index.html: untranslated ' + left.join(', '))
      return out.replace('lang="zh-CN"', `lang="${lang}"`)
                .replace('<head>', `<head>\n    <meta http-equiv="Content-Security-Policy" content="${csp}">`)
    },
    buildEnd() {
      if (!missing.size) return
      const list = [...missing].sort().join('\n  ')
      if (process.env.PPTIST_I18N_LAX) this.warn(`untranslated:\n  ${list}`)
      else this.error(`untranslated strings (add them to i18n/${lang}.json):\n  ${list}`)
    },
  }
}
