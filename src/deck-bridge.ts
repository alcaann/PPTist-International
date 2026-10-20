// fork: connect PPTist to a deck file on a small local server instead of the browser's storage.
//
//   ?deck=edit    editor; loads ../api/deck from the local server and saves every change back
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
import type { Slide, SlideTheme } from '@/types/slides'

export const deckMode = new URLSearchParams(window.location.search).get('deck') as 'edit' | 'view' | 'player' | null

interface Deck { title?: string; width?: number; height?: number; theme?: Partial<SlideTheme>; slides: Slide[] }

let version: string | null = null

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

async function save() {
  const r = await fetch('../api/deck', { method: 'PUT', headers: { 'Content-Type': 'application/json' },
                                         body: JSON.stringify({ version, deck: current() }) })
  if (r.status === 409) {
    message.error('deck.json changed on disk (another tab or a git pull): reload this page; this edit was not saved', { duration: 0 })
    stopSaving()
    return
  }
  if (!r.ok) throw new Error(String(r.status))
  version = (await r.json()).version
}

let stopSaving = () => {}

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
  // edit: autosave, debounced; failures are shown, never silent
  const store = useSlidesStore()
  let timer: ReturnType<typeof setTimeout> | null = null
  const stop = watch(() => [store.title, store.theme, store.slides, store.viewportSize, store.viewportRatio], () => {
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => save().catch(e => message.error('could not save deck.json: ' + e.message + ' (is the local server running?)')), 800)
  }, { deep: true })
  stopSaving = () => { stop(); if (timer) clearTimeout(timer) }
  if (!r.deck) save()
  return true
}
