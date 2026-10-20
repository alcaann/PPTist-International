// Shared by the Vite plugin (i18n-plugin.mjs) and the extractor (extract.mjs).
// A unit is a run that starts and ends with a CJK character (CJK punctuation counts) and may
// contain spaces, digits and ASCII words in between: "粘贴来自 pexels 的图片链接" is one unit.
const C = '\\u3000-\\u303f\\u4e00-\\u9fff\\uff00-\\uffef'
export const RUN = new RegExp(`[${C}](?:[${C}A-Za-z0-9 .:/%+\\-]*[${C}])?`, 'g')
export const HAS_CJK = new RegExp(`[${C}]`)

// Comments are left out of extraction (they never reach the browser).
export function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, '')
            .replace(/<!--[\s\S]*?-->/g, '')
            .replace(/(^|[^:'"`\\])\/\/[^\n]*/gm, '$1')
}

// What an English value must not contain: it replaces text inside JS strings, template
// literals, attributes and template text alike. A whole-message key may carry ${...}
// expressions; the value must then carry the same ones, and those are exempt.
export const FORBIDDEN = /['"`<>{}\\$]/

export function checkValue(key, value) {
  const exprs = key.match(/\$\{[^}]*\}/g) || []
  let rest = value
  for (const e of exprs) {
    if (!rest.includes(e)) return `must keep ${e}`
    rest = rest.split(e).join('')
  }
  if (FORBIDDEN.test(rest)) return 'contains a quote, bracket, backslash or $'
  if (HAS_CJK.test(value)) return 'still contains CJK'
  return null
}
