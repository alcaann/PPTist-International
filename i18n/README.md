# Translations

PPTist's own source is written in Chinese and has no translation layer. This fork does not
edit those strings in place (that would conflict with every upstream update); it translates
them **at build time**, from a dictionary per language:

```
i18n/en.json          zh -> en, one entry per Chinese run in src/
i18n/cjk.mjs          what counts as a run, and what a translation may not contain
i18n/i18n-plugin.mjs  the Vite plugin; fails the build on an untranslated string
i18n/extract.mjs      lists runs, or the ones missing from a dictionary
```

```bash
PPTIST_LANG=en npm run build     # default
PPTIST_LANG=zh npm run build     # the original Chinese UI
```

## Adding a language

1. `node i18n/extract.mjs . --missing --lang de > i18n/de.json` lists every string (with how
   often it occurs). Replace each count with the translation; `en.json` is a good reference
   for what a string means in the UI.
2. Messages built around variables are in `_whole` (see `en.json`): keep each `${...}`
   exactly as it is.
3. A translation may not contain `' " \` < > { } \ $` — it is pasted into JavaScript strings,
   templates and attributes alike. Use typographic quotes (“ ” ’) instead.
4. `PPTIST_LANG=de npm run build`, then `node audit/live.mjs` to see it running.

Pull requests with new languages, or better wording for existing ones, are welcome.

## After an upstream merge

`node i18n/extract.mjs . --missing` lists the new strings. The build refuses to finish until
each has a translation (`PPTIST_I18N_LAX=1` turns that into a warning while you work).
