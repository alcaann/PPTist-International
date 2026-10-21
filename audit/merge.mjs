#!/usr/bin/env node
// Tests for src/deck-merge.ts, the three-way merge behind several editors on one deck file.
//   node audit/merge.mjs
import { buildSync } from 'esbuild'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import assert from 'node:assert/strict'

const out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'deck-merge-')), 'merge.mjs')
buildSync({ entryPoints: ['src/deck-merge.ts'], outfile: out, format: 'esm', logLevel: 'warning' })
const { merge } = await import(out)
fs.rmSync(path.dirname(out), { recursive: true })

const el = (id, x=0) => ({ id, type: 'text', left: x, content: '<p>'+id+'</p>' })
const sl = (id, els=[], extra={}) => ({ id, elements: els, ...extra })
const B = { title: 'T', slides: [sl('a',[el('a1'),el('a2')]), sl('b'), sl('c')] }
const c = x => structuredClone(x)
let t, m, r
// 1. different slides
t=c(B); t.slides[1].remark='notes by them'; m=c(B); m.slides[0].elements[0].left=50
r=merge(B,t,m); assert.equal(r.value.slides[1].remark,'notes by them'); assert.equal(r.value.slides[0].elements[0].left,50); assert.deepEqual(r.conflicts,[])
// 2. same slide, different elements; plus both add elements
t=c(B); t.slides[0].elements[1].left=9; t.slides[0].elements.push(el('t3')); m=c(B); m.slides[0].elements[0].left=7; m.slides[0].elements.push(el('m3'))
r=merge(B,t,m); assert.deepEqual(r.value.slides[0].elements.map(e=>[e.id,e.left]),[['a1',7],['a2',9],['t3',0],['m3',0]]); assert.deepEqual(r.conflicts,[])
// 3. they add a slide after a, I delete c
t=c(B); t.slides.splice(1,0,sl('n')); m=c(B); m.slides.pop()
r=merge(B,t,m); assert.deepEqual(r.value.slides.map(s=>s.id),['a','n','b'])
// 4. I reorder (c first), they edit b
t=c(B); t.slides[1].remark='x'; m=c(B); m.slides=[m.slides[2],m.slides[0],m.slides[1]]
r=merge(B,t,m); assert.deepEqual(r.value.slides.map(s=>s.id),['c','a','b']); assert.equal(r.value.slides[2].remark,'x')
// 5. same value both: mine wins, reported
t=c(B); t.slides[2].remark='theirs'; m=c(B); m.slides[2].remark='mine'
r=merge(B,t,m); assert.equal(r.value.slides[2].remark,'mine'); assert.deepEqual(r.conflicts,['/slides/c/remark'])
// 6. I add a slide in the middle, they add one at the end
t=c(B); t.slides.push(sl('z')); m=c(B); m.slides.splice(1,0,sl('m'))
r=merge(B,t,m); assert.deepEqual(r.value.slides.map(s=>s.id),['a','m','b','c','z'])
// 7. they deleted a slide I edited: mine wins (kept), reported
t=c(B); t.slides.splice(1,1); m=c(B); m.slides[1].remark='keep me'
r=merge(B,t,m); assert.deepEqual(r.value.slides.map(s=>s.id),['a','b','c']); assert.equal(r.conflicts.length,1)
// 8. identical edits: no conflict
t=c(B); t.title='New'; m=c(B); m.title='New'; r=merge(B,t,m); assert.equal(r.value.title,'New'); assert.deepEqual(r.conflicts,[])
console.log("PASS: 8 merge cases")
