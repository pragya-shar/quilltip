# Bundle analysis reports (ENG-70)

Webpack Bundle Analyzer writes HTML treemaps to `.next/analyze/` when you run `bun run analyze`.

## Layout

- **`before/`** — baseline snapshot (copied from `.next/analyze/` after the first analyze run).
- **`after/`** — copy the same three files here after lazy-load work for comparison.

## Regenerate

```bash
bun run analyze
```

Then copy `.next/analyze/client.html`, `edge.html`, and `nodejs.html` into `before/` or `after/` as needed.

`next build` defaults to Turbopack; the analyzer requires webpack, so the `analyze` script uses `next build --webpack`.

## Baseline snapshot

| Field | Value |
| --- | --- |
| Git commit | `2f35c12d4a21d3e122f4b080097e372c296bcff7` |
| Generated | 2026-03-31 (baseline for ENG-70) |

Open `before/client.html` in a browser to inspect the client bundle.
