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

The roman file is preloaded; the italic loads only when a page draws italic
text. The Latin Extended files carry the subset's `unicode-range` and load
only when a page draws one of its letters ("Łukasz"); they sit second in the
family list, before the metric fallback. Neither subset has "≈" or "→":
the UI draws both in the platform face. `system/fonts.ts` loads both through `next/font/local` with a
metric-matched fallback.
