# Page-Load Performance

Target: largest contentful paint (LCP) under 2 s and cumulative layout shift
(CLS) under 0.1 on the landing page, `/login`, an article page and `/articles`,
for mobile and desktop. Issues #405 and #428.

- **Captured:** 2026-11-26, local production build (`next build` + `next start`)
- **Before:** `bb32529` (`overhaul/v2`)
- **After:** `554cf6f` (this change)
- **Data:** the public read-only backend that serves the live site, so the
  pages render real articles. Article route:
  `/q6da1413b91a046bf95c/she-signed-for-a-postcard`.
- **Tool:** Lighthouse 12.8.2, performance category, headless Chrome,
  incognito. Median of 3 cold runs per route and profile.

## Device profiles

| Profile                     | Device                          | Network and CPU                                          | Throttling method                             |
| --------------------------- | ------------------------------- | -------------------------------------------------------- | --------------------------------------------- |
| Mobile (Lighthouse default) | Moto G Power, 412x823, 1.75 DPR | Slow 4G (150 ms RTT, 1.6 Mbps down, 750 kbps up), 4x CPU | Simulated: an unthrottled load, then modelled |
| Mobile, applied             | Same                            | Same values, applied by DevTools while the page loads    | `--throttling-method=devtools`                |
| Desktop                     | 1350x940                        | 40 ms RTT, 10 Mbps, no CPU slowdown                      | Simulated (`--preset=desktop`)                |

## Results

LCP in ms, CLS unitless. Bold marks a miss.

| Route       | Profile         | LCP before | LCP after | CLS before | CLS after |
| ----------- | --------------- | ---------: | --------: | ---------: | --------: |
| `/`         | Mobile          |   **3940** |  **3670** |      0.057 |     0.002 |
| `/`         | Mobile, applied |       1698 |      1726 |      0.039 |     0.001 |
| `/`         | Desktop         |        844 |       828 |  **0.133** |     0.004 |
| `/login`    | Mobile          |   **4702** |  **3074** |      0.000 |     0.000 |
| `/login`    | Mobile, applied |   **4263** |      1574 |      0.000 |     0.016 |
| `/login`    | Desktop         |        803 |       661 |      0.000 |     0.000 |
| Article     | Mobile          |   **6544** |  **3765** |      0.000 |     0.000 |
| Article     | Mobile, applied |   **2207** |      1761 |  **0.440** |     0.000 |
| Article     | Desktop         |       1294 |       771 |  **0.431** |     0.001 |
| `/articles` | Mobile          |   **7183** |  **3364** |  **0.221** |     0.005 |
| `/articles` | Mobile, applied |  **10711** |      1800 |  **0.309** |     0.005 |
| `/articles` | Desktop         |       1780 |       731 |      0.045 |     0.002 |

Desktop meets both targets on every route. With the mobile profile applied
while the page loads, every route now meets both targets; the landing page
already did before (1698 ms against 1726 ms after is within run-to-run
variation). The simulated
mobile profile still misses LCP on all four routes; see
[Remaining gap](#remaining-gap-simulated-mobile).

## LCP element and phases

Mobile, simulated, median run.

| Route       | LCP element                       | Before: TTFB / load delay / load time / render delay (ms) | After (ms)               |
| ----------- | --------------------------------- | --------------------------------------------------------- | ------------------------ |
| `/`         | Sample passage text               | 457 / 0 / 0 / 3484                                        | 453 / 0 / 0 / 3212       |
| `/login`    | "Back to your reading & writing." | 472 / 0 / 0 / 4373                                        | 453 / 0 / 0 / 2463       |
| Article     | First body paragraph              | 548 / 0 / 0 / 5996                                        | 453 / 0 / 0 / about 3300 |
| `/articles` | First card cover image            | 455 / 4107 / 2458 / 163                                   | 452 / 386 / 144 / 2384   |

Render delay is the time from the HTML to the paint. In the simulation it grows
with every byte that finishes before the paint (see below).

## What changed

- **`/login`:** the whole screen sat under a client-only boundary
  (`useSearchParams` inside `<Suspense fallback={null}>`), so the first HTML
  was empty until the script ran. The page now reads the return path on the
  server and renders the screen in the first HTML. Validation code (zod) and
  the tip-resume helper load on submit. The form posts with `method="post"`,
  so a submit before the script loads never puts credentials in the URL.
- **`/articles`:** the list rendered only after the client query answered, so
  the cover image was found about 4 s late. The page now renders the first list
  on the server (cached for 60 s; the live query takes over in the browser).
  Covers use `getImageProps` (sized AVIF/WebP from the Next.js image
  optimizer, about 1.5 MB to 0.8 MB per page). The first cover is eager with
  high fetch priority. The first row shows at once instead of waiting for the
  load reveal. The cover hover and reveal moved from Motion to CSS transitions
  with the same spring shape (removes about 41 KB of script). Cards in the first
  HTML no longer play the entry fade; cards that arrive later still do.
  Reduced motion turns both off.
- **Article page:**
  - The highlight editor replaced the static body with one empty frame. That
    shifted the footer into view and back (CLS 0.43) and reported a new LCP
    when the editor painted. The static body now stays until the editor has
    rendered, then both change in one commit. The static body uses the
    editor's text rules (`.article-static-body`), so lines wrap the same.
    The editor loads when the browser is idle after load.
  - The body HTML is rendered on the server, so readers no longer download
    Tiptap and ProseMirror (about 170 KB) before the article appears.
  - The tip flow loads after the page (the tip skeleton shows until then, as
    before). The Stellar config check no longer imports a schema library
    (about 30 KB).
  - The public article read is cached for 60 s and the proxy reuses a "found"
    route check for 60 s per instance, so article HTML no longer waits for two
    backend round trips (about 500 ms to under 20 ms on a warm cache).
    Missing articles are never cached, and the page subscribes to the live
    article on load, so edits still appear at once.
- **Every page:** the root 404 screen imported the writer-not-found page and the
  full site header, so every route downloaded dialog and menu code. That
  screen now loads on demand.
- **Fonts:** Syne 600 was served from four URLs (one named "variable" with
  identical bytes), Work Sans 400 and Alegreya italic from two. Each file now
  has one URL. The root layout preloads only Syne 600. Pages preload their
  own first-screen faces (`lib/fonts/preloadFonts.ts`). The landing page
  preloads Alegreya, which fixes the desktop shift (0.133) when the sample
  passage rewrapped on font swap.

Not changed: the landing intro animation. It does not affect LCP (the passage
paints before the intro starts), and it stays skippable and off for reduced
motion.

## Remaining gap: simulated mobile

The simulated profile estimates LCP from the nodes of an unthrottled load that
finished before the observed first paint, then replays them on Slow 4G. On a
local build, every script and font finishes within about 50 ms, before the
paint. Fonts can delay the first paint by up to about 100 ms; scripts do not
(checked by delaying them in the browser). The simulation still charges all of
those bytes to LCP. The estimate rises by about 8 ms per KB on top of about
650 ms of fixed cost.

Bytes finished before the first paint, mobile, after this change:

| Route       |  Total | Script | Fonts | CSS | HTML | Image |
| ----------- | -----: | -----: | ----: | --: | ---: | ----: |
| `/`         | 425 KB |    231 |   141 |  43 |   10 |     0 |
| `/login`    | 291 KB |    208 |    44 |  31 |    9 |     0 |
| Article     | 458 KB |    267 |   138 |  30 |   13 |     0 |
| `/articles` | 420 KB |    206 |    64 |  32 |   37 |    81 |

Next.js and React alone are about 145 KB of that script. To reach 2 s in the
simulated profile, a route would need about 170 KB or less before the first
paint. That means fewer typefaces on the first screen (a design change: the
landing page uses ten faces) and a smaller framework footprint. The applied
mobile profile, which loads the page under the same network and CPU limits,
meets the target on every route.

## Regression check

`bun run perf:budget` (`scripts/perf/page-load-budget.ts`) runs without
secrets:

1. Build with `NEXT_PUBLIC_CONVEX_URL=http://127.0.0.1:3299`.
2. The script starts a stand-in for the public queries on port 3299, serving
   synthetic data (`scripts/perf/convex-fixture.ts`), and `next start` on
   port 3199.
3. For each route it loads the page three times in Chromium, on mobile (Slow
   4G and 4x CPU applied through the DevTools protocol) and on desktop.
4. It fails when a median breaks a budget:
   - LCP: 2000 ms mobile, 1000 ms desktop.
   - CLS: 0.1.
   - Initial script: 280 KB. Initial fonts: 180 KB.
   - The LCP element must be in the server HTML.

The CI workflow runs it as the **Page-load Budget** job. Result on `554cf6f`:

| Route       | Mobile LCP | Mobile CLS | Desktop LCP | Desktop CLS | Script |  Fonts |
| ----------- | ---------: | ---------: | ----------: | ----------: | -----: | -----: |
| `/`         |     944 ms |      0.001 |       52 ms |       0.004 | 227 KB | 133 KB |
| `/login`    |     856 ms |      0.016 |       44 ms |       0.000 | 202 KB |  41 KB |
| Article     |     920 ms |      0.000 |       56 ms |       0.001 | 260 KB | 103 KB |
| `/articles` |    1272 ms |      0.005 |       80 ms |       0.002 | 201 KB |  61 KB |

The fixture has no cover images and the stand-in never sends live data, so
these numbers are lower than the real-data runs above. Use the check for
regressions, not as the measured result.

## Re-run

```bash
# Real data (read-only public queries), Lighthouse
NEXT_PUBLIC_CONVEX_URL=<public deployment URL> bun run build
bun run start -- -p 3100
bunx lighthouse@12.8.2 http://127.0.0.1:3100/login --only-categories=performance --output=json --chrome-flags="--headless=new --incognito"
# add --preset=desktop for desktop, --throttling-method=devtools for applied mobile
```

The live-site navigation-timing report from `bun run perf:page-load` is in
[page-load-live.md](page-load-live.md).
