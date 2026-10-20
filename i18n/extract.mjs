#!/usr/bin/env node
// List every Chinese UI run in PPTist's src/ and compare with a dictionary.
//   node i18n/extract.mjs <PPTist dir> [--missing] [--lang en]     -> JSON {run: count}
// A new language: node i18n/extract.mjs . --missing --lang xx > i18n/xx.json, then translate.
import fs from 'node:fs'
import path from 'node:path'
import { RUN, stripComments } from './cjk.mjs'

const args = process.argv.slice(2)
const dir = args[0], flag = args.includes('--missing') ? '--missing' : null
const lang = args.includes('--lang') ? args[args.indexOf('--lang') + 1] : 'en'
const file = new URL(`./${lang}.json`, import.meta.url)
const dict = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file)) : {}
const out = {}
const walk = d => fs.readdirSync(d, { withFileTypes: true }).forEach(e => {
  const p = path.join(d, e.name)
  if (e.isDirectory()) return walk(p)
  if (!/\.(vue|ts|tsx|js)$/.test(e.name)) return
  for (const m of stripComments(fs.readFileSync(p, 'utf8')).match(RUN) || []) out[m] = (out[m] || 0) + 1
})
walk(path.join(dir, 'src'))
const keys = Object.keys(out).filter(k => flag !== '--missing' || !(k in dict))
console.log(JSON.stringify(Object.fromEntries(keys.sort().map(k => [k, out[k]])), null, 1))
console.error(`${Object.keys(out).length} runs, ${keys.length} ${flag === '--missing' ? 'missing from ' + lang + '.json' : 'listed'}`)
