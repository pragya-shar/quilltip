# Reading face

Literata (OFL 1.1, no reserved font name; `literata-LICENSE.txt`), from
`@fontsource-variable/literata` 5.3.0, Latin subset, optical-size files
(`literata-latin-opsz-{normal,italic}.woff2`). Instanced with fontTools
4.55.3 to the ranges the design uses, which halves the files:

```
fonttools varLib.instancer literata-latin-opsz-normal.woff2 wght=400:700 opsz=12:60
```

| File                          | Axes                           | Size  |
| ----------------------------- | ------------------------------ | ----- |
| `literata-latin-normal.woff2` | opsz 12 to 60, wght 400 to 700 | 60 KB |
| `literata-latin-italic.woff2` | opsz 12 to 60, wght 400 to 700 | 62 KB |

The roman file is preloaded; the italic loads only when a page draws italic
text. `system/fonts.ts` loads both through `next/font/local` with a
metric-matched fallback.
