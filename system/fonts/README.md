# Reading face

Literata (OFL 1.1, no reserved font name; `literata-LICENSE.txt`), from
`@fontsource-variable/literata` 5.3.0, Latin and Latin Extended subsets,
optical-size files (`literata-latin-opsz-{normal,italic}.woff2`,
`literata-latin-ext-opsz-{normal,italic}.woff2`). Instanced with fontTools
4.55.3 to the ranges the design uses, which halves the files:

```
fonttools varLib.instancer literata-latin-opsz-normal.woff2 wght=400:700 opsz=12:60
```

(and the same for the italic and the two Latin Extended files).

| File                              | Axes                           | Size  |
| --------------------------------- | ------------------------------ | ----- |
| `literata-latin-normal.woff2`     | opsz 12 to 60, wght 400 to 700 | 60 KB |
| `literata-latin-italic.woff2`     | opsz 12 to 60, wght 400 to 700 | 62 KB |
| `literata-latin-ext-normal.woff2` | opsz 12 to 60, wght 400 to 700 | 50 KB |
| `literata-latin-ext-italic.woff2` | opsz 12 to 60, wght 400 to 700 | 50 KB |

All four load with `font-display: optional`: a page view that starts in the
fallback stays in it, so reading text never changes face or line breaks
inside a view; the next page view upgrades to them under second family
names on the same files (see `system/README.md`). The roman file is preloaded; the
italic loads only when a page draws italic text. The Latin Extended files carry the subset's `unicode-range` and load
only when a page draws one of its letters ("Łukasz"); they sit second in the
family list, before the metric fallback. Neither subset has "≈" or "→":
the UI draws both in the platform face. `system/fonts.ts` loads both through `next/font/local` with a
metric-matched fallback of its own:
`system/font-fallbacks.css` gives Times New Roman (or Liberation Serif)
Literata's width and line metrics in one face per weight band, with the bold
file from 550, plus faces for the display title. next/font's own fallback has
one face only, and bold titles re-wrapped at the swap in WebKit. The values come from
Literata instanced at each weight, the way next/font computes its fallback,
and the display values are checked against real titles in the browser.
