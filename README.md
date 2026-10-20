<p align="center">
    <img src='/public/logo.png' />
</p>

# PPTist International

A PowerPoint-style slide editor that runs in the browser: text, images, shapes, lines, charts,
tables, video, audio and LaTeX formulas, with themes, transitions, animations, speaker notes and
a presenter view. It imports and exports `.pptx`.

**Try it: [alcaann.github.io/PPTist-International](https://alcaann.github.io/PPTist-International/)**
(decks stay in your browser; nothing is uploaded).

This is a fork of [PPTist](https://github.com/pipipi-pikachu/PPTist) by
[pipipi-pikachu](https://github.com/pipipi-pikachu), whose editor it is. The fork changes three
things:

- **The interface is in English** (and can be in any language), translated at build time.
- **It makes no third-party connections.** Upstream's AI features, online image library,
  built-in templates and web-font loader are removed, and the page may contact only the
  server it came from.
- **Decks can be plain JSON files**, loaded and saved through a small local server, so they
  can live in a git repository.

## Checked, not promised

Two audits run on every build, here and in CI, and the demo above is published only if both pass:

- **`audit/static.mjs`** scans the built bundle. It checks every host the code names (each one
  is reviewed, and a new one fails until someone looks at it), every network call site, the
  Content-Security-Policy, and AI or cloud vocabulary. Every Chinese string left in the bundle
  must have a stated reason, for example a library's built-in locale that is never shown.
- **`audit/live.mjs`** runs the editor in headless Chrome, clicks through about 60 controls,
  inserts content, and opens the slideshow. It fails on any request leaving the local server,
  any request the security policy had to block (meaning some code still *tried*), and any
  Chinese on screen.

A control run with an injected fetch, an external image and a Chinese label fails, as it should.

## Quick start

Node 20 or newer.

```bash
npm ci --ignore-scripts
npm run dev                          # http://127.0.0.1:5173/
npm run build                        # dist/
node audit/static.mjs && node audit/live.mjs
```

### What gets removed, and why

| Upstream feature | Contacted | In this fork |
|---|---|---|
| AI slide generation, AI rewrite/expand/shorten | the author's server | removed |
| Online image library | the author's server (Pexels photos) | removed |
| Built-in templates | pexels.com (photos); Chinese sample text | removed |
| Google Fonts loader on import | fonts.googleapis.com | removed |
| Sample video/audio URLs | third-party media hosts | emptied |
| Package downloads | a mirror registry (in the lockfile) | official npm registry, same hashes |

Everything else works as upstream: import and export (PPTX, JSON, images, PDF via print),
editing, charts, tables, formulas, animations, slideshow tools and the mobile view.

### Decks as files

`src/deck-bridge.ts` adds three modes, chosen in the URL:

| URL | What it does |
|---|---|
| `?deck=edit` | loads the deck from `GET ../api/deck` and saves it back with `PUT`, about a second after each change; if the file changed on disk meanwhile (HTTP 409), it stops saving and says so |
| `?deck=view` | a slideshow another page drives with `postMessage({deckSlide: n})` |
| `?deck=player` | plays a `deck.json` next to the page, read-only (for publishing a talk) |

Without `?deck=` the editor behaves as upstream and keeps the deck in browser storage. The
server side is small and can be written in any language: it serves `dist/`, answers `GET /api/deck` with
`{version, deck}`, and accepts `PUT /api/deck` with `{version, deck}`.

## Help wanted

PPTist is an excellent editor, and upstream documents its online features and makes them optional.
This fork is for people who need something narrower: an editor for slides that may be
confidential (unpublished research, internal material), in their own language, whose build
they can **check** sends nothing anywhere instead of taking it on trust. Two kinds of help make
that more useful:

- **Translations.** One JSON file per language, no code: see [i18n/README.md](i18n/README.md).
  Corrections to the English wording are just as welcome. The developer docs in `doc/` are
  still upstream's Chinese originals; English versions would help too.
- **Review.** Try to break the guarantee. A request the audits miss, a dependency that phones
  home, a way around the Content-Security-Policy, or a Chinese string that reaches the screen:
  please [open an issue](https://github.com/alcaann/PPTist-International/issues). For anything
  exploitable, say so in the title and leave out the details until it is fixed. Improvements to
  `audit/` itself are the most valuable kind of pull request here.

## Staying current with upstream

Branch `international` is upstream's `master` plus a short series of commits. Upstream's source
files are left as they are wherever possible (translation happens at build time), so merging
is usually clean:

```bash
git fetch upstream && git merge upstream/master
node i18n/extract.mjs . --missing    # new strings to translate; the build refuses until done
npm run build && node audit/static.mjs && node audit/live.mjs
```

A new feature upstream that contacts a server makes the audits fail, and it stays out until
someone has looked at it.

## For developers

Upstream's documentation applies unchanged, except for the removed features above. It is in
Chinese: [project structure and data](doc/DirectoryAndData.md), [canvas and
elements](doc/Canvas.md), [custom elements](doc/CustomElement.md), [FAQ](doc/Q&A.md).
Upstream's full README, with the complete feature list, is kept in
[README.upstream.md](README.upstream.md) ([Chinese](README_zh.md)).

## Credit and licence

The editor is the work of pipipi-pikachu and PPTist's contributors: Copyright © 2020-present
[pipipi-pikachu](https://github.com/pipipi-pikachu). If it is useful to you, consider supporting
the original project (see [README.upstream.md](README.upstream.md#-sponsorship--support)).

Licensed under [AGPL-3.0](LICENSE), like upstream, and this fork's changes are AGPL-3.0 as well.
If you host a modified version, its source must be available to its users. Upstream also
offers separate commercial licences for closed-source commercial use. They cover upstream's
code only, and this fork cannot grant them.
