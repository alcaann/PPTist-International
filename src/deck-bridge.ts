// fork: connect PPTist to a deck file on a small local server instead of the browser's storage.
//
//   ?deck=edit    editor; loads ../api/deck from the local server, saves every change back, and
//                 merges in changes other editors of the same file save (see deck-merge.ts)
//                 (GET/PUT ../api/deck; the server keeps it as a plain JSON file git can diff)
//   ?deck=view    slideshow only, driven by a parent page: postMessage({deckSlide: n})
//   ?deck=player  slideshow only, from ./deck.json next to the page (the published copy)
//   (no deck)    upstream behaviour
//
// The deck file is PPTist's own export format (title, width, height, theme, slides), but
// unencrypted: upstream's .pptist export is the same JSON, AES-encrypted with a fixed key.
import { watch } from 'vue'
import { nanoid } from 'nanoid'
import { useSlidesStore, useScreenStore } from '@/store'
import message from '@/utils/message'
import { db } from '@/utils/database'
import { merge, same } from './deck-merge'
import type { Slide, SlideTheme } from '@/types/slides'

export const deckMode = new URLSearchParams(window.location.search).get('deck') as 'edit' | 'view' | 'player' | null

interface Deck { title?: string; width?: number; height?: number; theme?: Partial<SlideTheme>; slides: Slide[] }

let version: string | null = null   // the server's version this editor last caught up with
let base: Deck | null = null        // ...and that version's content: the ancestor of local edits

function blankDeck(): Deck {
  return { title: 'Untitled presentation', slides: [{ id: nanoid(10), elements: [], background: { type: 'solid', color: '#fff' } }] }
}

function apply(deck: Deck) {
  const store = useSlidesStore()
  if (deck.title) store.setTitle(deck.title)
  if (deck.width) {
    store.setViewportSize(deck.width)
    if (deck.height) store.setViewportRatio(deck.height / deck.width)
  }
  if (deck.theme) store.setTheme(deck.theme)
  store.setSlides(deck.slides?.length ? deck.slides : blankDeck().slides)
}

function current(): Deck {
  const s = useSlidesStore()
  return { title: s.title, width: s.viewportSize, height: s.viewportSize * s.viewportRatio,
           theme: s.theme, slides: s.slides }
}

const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x))

function slideLabel(path: string, deck: Deck) {
  const id = path.match(/^\/slides\/([^/]+)/)?.[1]
  const n = id ? deck.slides.findIndex(s => s.id === id) : -1
  return n >= 0 ? `slide ${n + 1}` : 'the deck settings'
}

/** Puts a merged deck into the editor: keeps the open slide, and rewrites the undo history so
 *  that undo only takes back this editor's own changes, never someone else's. */
async function applyMerged(merged: Deck, before: Deck) {
  const store = useSlidesStore()
  const openId = store.slides[store.slideIndex]?.id
  apply(clone(merged))                  // the store edits in place: never hand it `base`'s objects
  const at = merged.slides.findIndex(s => s.id === openId)
  store.updateSlideIndex(at >= 0 ? at : Math.min(store.slideIndex, merged.slides.length - 1))
  await db.snapshots.toCollection().modify(snap => {
    snap.slides = merge(before.slides, snap.slides, merged.slides).value
  })
}

/** One round: take in whatever changed on the server, then send what changed here. */
async function sync() {
  for (let attempt = 0; attempt < 5; attempt++) {
    const local = clone(current())
    const r = await (await fetch(`../api/deck?v=${encodeURIComponent(version || '')}`)).json()
    if (r.version !== version && !r.unchanged) {
      const theirs: Deck = r.deck || blankDeck()
      const m = merge(base || theirs, theirs, local)
      if (!same(m.value, local)) {
        if (!same(clone(current()), local)) continue          // edited meanwhile: start over
        await applyMerged(m.value, local)
      }
      if (m.conflicts.length) {
        const where = [...new Set(m.conflicts.map(p => slideLabel(p, m.value)))].join(', ')
        message.warning(`Someone else changed the same thing on ${where} at the same time; your version was kept`, { duration: 8000 })
      }
      version = r.version
      base = theirs
      if (same(m.value, theirs)) return
    }
    else if (base && same(local, base)) return
    const sent = clone(current())
    const w = await fetch('../api/deck', { method: 'PUT', headers: { 'Content-Type': 'application/json' },
                                           body: JSON.stringify({ version, deck: sent }) })
    if (w.status === 409) continue                             // someone saved first: merge again
    if (!w.ok) throw new Error(String(w.status))
    version = (await w.json()).version
    base = sent
    return
  }
  throw new Error('the deck kept changing on the server')
}

// one round at a time, at most one more waiting; an error is shown once until saving works again
let running: Promise<void> = Promise.resolve(), queued = false, failing = false
function syncSoon() {
  if (queued) return running
  queued = true
  running = running.then(() => { queued = false; return sync() }).then(() => { failing = false }, e => {
    if (!failing) message.error('could not save deck.json: ' + e.message + ' (is the local server running?)', { duration: 0 })
    failing = true
  })
  return running
}

/** Loads the deck for the current mode. Returns false without ?deck= (caller falls back). */
export async function deckLoad(): Promise<boolean> {
  if (!deckMode) return false
  window.onbeforeunload = null
  if (deckMode === 'player') {
    apply(await (await fetch('./deck.json')).json())
    useScreenStore().setScreening(true)
    return true
  }
  const r = await (await fetch('../api/deck')).json()
  version = r.version
  base = r.deck && clone(r.deck)
  apply(r.deck || blankDeck())
  if (deckMode === 'view') {
    useScreenStore().setScreening(true)
    addEventListener('message', e => {
      if (e.origin !== location.origin || typeof e.data?.deckSlide !== 'number') return
      const store = useSlidesStore()
      store.updateSlideIndex(Math.max(0, Math.min(store.slides.length - 1, e.data.deckSlide)))
    })
    return true
  }
  // edit: save each change (debounced), and every 2 s take in other editors' changes (a
  // `git pull`, another tab, a collaborator on the same server). Failures are shown.
  const store = useSlidesStore()
  let timer: ReturnType<typeof setTimeout> | null = null
  watch(() => [store.title, store.theme, store.slides, store.viewportSize, store.viewportRatio], () => {
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => { timer = null; syncSoon() }, 800)
  }, { deep: true })
  setInterval(() => { if (!timer) syncSoon() }, 2000)
  if (!r.deck) syncSoon()
  return true
}
