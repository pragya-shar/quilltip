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
    Missing articles are never cached, and no cached copy is used once it is
    more than 60 s old, so an unpublished article leaves the server HTML within
    a minute. The page subscribes to the live article on load, so edits still
    appear at once.
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

## After the shared header (#436)

Re-measured on `overhaul/v2` at `cdd6509`, after the shared header and writer
pages (#436) and this change were both merged. Local production build with the
synthetic fixture backend that `bun run perf:budget` uses, so the data differs
from the tables above; compare the two rows for each route, not these values
with the earlier tables. Lighthouse 12.8.2, median of 5 runs per route and
profile. "Before" is this change alone (`ae08f14`), measured the same way.

| Route       | Profile         | LCP before | LCP after | CLS after |
| ----------- | --------------- | ---------: | --------: | --------: |
| `/`         | Mobile          |   **3830** |  **3932** |     0.002 |
| `/`         | Mobile, applied |       1714 |      1731 |     0.001 |
| `/`         | Desktop         |        827 |       817 |     0.004 |
| `/login`    | Mobile          |   **3066** |  **2918** |     0.000 |
| `/login`    | Mobile, applied |       1573 |      1563 |     0.016 |
| `/login`    | Desktop         |        620 |       619 |     0.000 |
| Article     | Mobile          |   **3664** |  **3669** |     0.000 |
| Article     | Mobile, applied |       1744 |      1764 |     0.000 |
| Article     | Desktop         |        731 |       740 |     0.001 |
| `/articles` | Mobile          |   **3362** |  **3740** |     0.005 |
| `/articles` | Mobile, applied |       1802 |      1867 |     0.005 |
| `/articles` | Desktop         |        723 |       746 |     0.003 |

Desktop and the applied mobile profile still meet LCP < 2 s and CLS < 0.1 on
every route. The simulated mobile profile still misses LCP on all four. On
`/articles` it rose about 380 ms: the shared header adds about 47 KB of script
and 29 KB of fonts before the first paint there (414 to 491 KB in total). The
other routes moved within run-to-run variation.

## Simulated mobile on `overhaul/v2` (#405, #428)

Measured 2026-11-27. The targets are LCP under 2 s and CLS under 0.1 on `/`,
`/login`, `/articles` and an article page.

### Method

- **Builds:** `next build` and `next start` (port 3104), local production
  builds. Before: `overhaul/v2` at `fab8e06`. After: this change.
- **Data:** a local Convex backend (anonymous local deployment) seeded through
  the app's own sign-up, wallet-proof and publish mutations: three writers,
  13 published articles with Unsplash covers, and a reader with three public
  highlights. The article page is a 3,600-word article with eight headings and
  two images, written from non-repeating text so that its HTML compresses like
  real prose (98 KB raw, 28 KB gzip). An article built from repeated sentences
  compressed to 10 KB, which understated the HTML cost.
- **Tool:** Lighthouse 12.8.2, performance category, headless Chrome,
  incognito, signed out. Five cold runs per route and profile; the tables show
  the median.
- **Profiles:** Lighthouse's default mobile profile (Moto G Power, 412 px
  wide, simulated Slow 4G: 150 ms RTT, 1.6 Mbps, 4x CPU) is the stated method.
  Desktop (`--preset=desktop`) is measured for CLS. "Applied" is the same
  mobile profile with `--throttling-method=devtools`, which slows the real
  load instead of modelling it.

### Results

LCP in ms. Bold marks a miss.

| Route       | Simulated mobile, before | Simulated mobile, after | Applied, before | Applied, after | Desktop, before | Desktop, after |
| ----------- | -----------------------: | ----------------------: | --------------: | -------------: | --------------: | -------------: |
| `/`         |                 **3986** |                **3664** |            1801 |           1873 |             836 |            792 |
| `/login`    |                 **2934** |                **2918** |            1601 |           1631 |             631 |            623 |
| `/articles` |                 **3786** |                **3749** |            1860 |           1845 |             763 |            808 |
| Article     |                 **3817** |                **3511** |        **2114** |       **2098** |             781 |            711 |

CLS after, simulated mobile and desktop: `/` 0.002 and 0.004, `/login` 0.016
and 0.000, `/articles` 0.005 and 0.003, article 0.000 and 0.001. All routes
meet CLS < 0.1 before and after. Total blocking time on the article page fell
from 183 ms to 31 ms (simulated mobile, repeated-text article).

First-load JavaScript (gzip, `bun run perf:first-load`):

| Route       |   Before |    After |
| ----------- | -------: | -------: |
| `/`         | 245.4 KB | 199.0 KB |
| `/login`    | 199.2 KB | 189.5 KB |
| `/articles` | 247.6 KB | 203.2 KB |
| Article     | 262.9 KB | 206.6 KB |

The simulated mobile profile still misses LCP on all four routes; the next
section gives the cause. Applied throttling meets LCP on `/`, `/login` and
`/articles`; the article page misses by about 100 ms (see
[Remaining](#remaining)).

### Why simulated mobile LCP stays above 2 s

On every route the LCP element is in the server HTML and the LCP phases are
TTFB about 450 ms, no load delay, and a render delay of 2.5 to 3.5 s
(`/articles`: the first cover image, about 240 ms load delay and 370 ms load
time). The render delay is not work the page does before painting:

1. Lighthouse's simulation records one unthrottled load, then replays every
   request that finished before the observed LCP, and every script that ran
   before it, on Slow 4G with a 4x CPU.
2. On the unthrottled local load, Chrome evaluates the page's async scripts
   before it presents the first frame: the first frame is presented at 80 to
   120 ms, after all first-load chunks have run. So the simulation charges the
   whole first load (about 200 KB of JavaScript, 30 to 45 KB of CSS and 44 to
   142 KB of fonts) to LCP.
3. Experiment: a proxy that delays only `.js` responses by 400 ms, so the same
   page paints before any script runs, with the same bytes. Simulated mobile
   LCP falls to 1512 ms (`/`), 1213 ms (`/login`), 1815 ms (`/articles`) and
   2306 ms (article), median of 3. Scripts account for 1.7 to 2.2 s of the
   simulated LCP.
4. Under applied throttling, Chrome paints before most scripts run: on the
   article page the first-load chunks start to evaluate after the first paint,
   and LCP is set by the HTML, the render-blocking stylesheets and the
   preloaded fonts.

Next.js and React are about 170 KB of each route's first load and the Convex
client about 30 KB (module sizes from `next experimental-analyze`). To meet
2 s in the simulated profile without the ordering above, a route would need
about 170 KB or less of all resources before its first paint. That is below
the framework alone, so it is not reachable with small client changes.

### What changed

Each change removes code from the first load without changing what the page
shows. Screenshots before and after at 375, 768 and 1440 px, signed in and
signed out, with and without reduced motion, are pixel-identical apart from
animation timing.

- **Toasts:** the toaster mounts after hydration (`next/dynamic`). Sonner keeps
  toasts raised before it mounts and shows them when it does. About 9 KB from
  every route.
- **Site header:** the mobile navigation sheet (Radix dialog, focus trap,
  scroll lock) loads after the page has loaded and the browser is idle, on
  hover or focus of the menu button, or on the first press. The button is a
  plain button with `aria-haspopup="dialog"` and `aria-expanded`; focus returns
  to it when the sheet closes. The signed-in account menu (Radix dropdown and
  positioning) loads when a signed-in header renders; until then the same
  trigger shows, and a press opens the menu as soon as it has loaded. About
  35 KB from `/`, `/articles` and the article page.
- **Landing tip preview:** the "Add a tip" dialog and its wallet help load
  after the page has loaded, or on hover, focus or press. The opening intro is
  unchanged (owner decision in #405).
- **Article details panel:** the collapsed panel below the article (accordion,
  highlight notes, date formatting) is still rendered on the server; its code
  loads while the page hydrates instead of with the first scripts.
- `afterLoadWhenIdle` (`lib/scheduling/`) is shared by these deferrals and the
  highlight editor.

Checked and left as they are:

- **Fonts:** every face a route downloads is used in its first viewport.
  Fewer faces would be a design change.
- **Inlined CSS** (`experimental.inlineCss`): Next.js wrote the CSS into the
  HTML three times; the login HTML grew from 9 KB to 96 KB gzip and simulated
  LCP rose. Not used.
- **Article HTML:** the body appears in the HTML as rendered HTML, as a string
  for hydration, as the Tiptap document and as search text. Leaving out the
  last two cut the raw HTML from 98 KB to 68 KB but the gzip size only from
  27.9 KB to 27.2 KB, because gzip already deduplicates the copies. Not worth
  the extra code.

### Remaining

- **Simulated mobile LCP, all four routes:** the measurement charges the
  framework and app JavaScript that the unthrottled load runs before its first
  frame (see above). The floor without scripts is 1.2 to 1.8 s on `/`,
  `/login` and `/articles`. Getting under 2 s with scripts counted needs a
  product decision: fewer typefaces on the landing page (ten faces, 142 KB
  before first paint) and a smaller framework footprint.
- **Article page, applied mobile (2098 ms) and the simulated floor
  (2306 ms):** the 29 KB HTML, the 25 KB global stylesheet and three preloaded
  fonts (60 KB) share Slow 4G bandwidth, so the global stylesheet finishes at
  about 2.0 s and the first paint follows. The global stylesheet carries the
  Tailwind utilities of the whole app. Splitting it per route, or not
  preloading the interface and title fonts on article pages (which would make
  them swap after the first paint), are the options; both are larger than this
  change.
- **`/` applied:** 1873 ms against 1801 ms before. In the new runs the Syne
  font finishes before the global stylesheet instead of after it; the bytes on
  the critical path are the same.

### Signed in

Article page, signed in as a reader with public highlights (a Chrome profile
with a real session; the HTTP cache cleared before each run), median of 5:
simulated mobile LCP 3815 ms before and 3513 ms after, desktop 778 and 701 ms.
CLS is 0.049 on mobile before and after: the reader header moves once the
signed-in reader's highlight rail appears. It is under the 0.1 target and not
changed here. The account menu and the tip flow load after hydration, so
signing in adds nothing to the first load.

## Regression check

`bun run perf:budget` (`scripts/perf/page-load-budget.ts`) runs without
secrets:

1. Build with `NEXT_PUBLIC_CONVEX_URL=http://127.0.0.1:3299`.
2. The script starts a stand-in for the public queries on port 3299, serving
   synthetic data (`scripts/perf/convex-fixture.ts`), and `next start` on
   port 3199.
3. For each route it reads the server HTML, then loads the page in Chromium on
   mobile (Slow 4G and 4x CPU applied through the DevTools protocol) and on
   desktop: one unmeasured warm-up load, then three measured loads.
4. It fails when a value breaks a budget. Each gated value depends on what the
   page loads, not on how fast the machine runs:

   | Gate                                         | Budget | Heaviest route |
   | -------------------------------------------- | -----: | -------------: |
   | Scripts referenced by the server HTML        | 230 KB |         206 KB |
   | Stylesheets referenced by the server HTML    |  50 KB |          41 KB |
   | Fonts the page requests                      | 220 KB |         181 KB |
   | Render-blocking stylesheets                  |      6 |              3 |
   | CLS (median of 3)                            |    0.1 |          0.016 |
   | LCP element in the server HTML (2 of 3 runs) |    yes |            yes |
   | LCP image URL in the server HTML (2 of 3)    |    yes |            yes |

   Bytes are compressed sizes as served by `next start`. Which element the
   browser reports as the largest paint can depend on timing: on a slow run
   the landing page's client-side opening animation can be reported. So the
   LCP element checks pass when two of the three runs pass, like the medians,
   and a single miss adds a warning that names the element. A page whose main
   content is rendered only in the browser fails every run. The element's
   text is compared with the server HTML's visible text, so escaped
   characters and inline tags do not cause a false miss.

5. It reports LCP (median and range of the three runs) and the scripts loaded
   after the first HTML (for example the highlight editor), without gating
   them. A median LCP over 2000 ms on mobile or 1000 ms on desktop adds a
   warning annotation to the CI run.

The same CI job first runs `bun run perf:first-load`, which budgets each
route's first-load JavaScript and refuses wallet, SDK and contract code there.
See [First-load JavaScript](#first-load-javascript).

### Why LCP time is not gated

The CI workflow runs the check as the **Page-load Budget** job on shared
runners. An earlier version gated LCP and "script bytes finished before the
load event". The second value failed on `c597e7a` and on two runs of #473
with 371 KB against a 280 KB budget, while the same commit passed on rerun and
measured 261 KB locally. The extra bytes were chunks that start after
hydration (89 KB and 15 KB, started at 2630 ms). On a slower runner the load
event came later (3584 ms), so they finished before it and counted. The
current gate counts only files that the server HTML references, so the result
does not depend on the runner's speed.

LCP itself moved by up to 60 ms between runs on one machine, and the median
of three stayed far below the targets on CI (about 1250 ms at most). It is
still measured on every run, so a regression shows in the log and as a
warning, and the deterministic gates catch its usual causes: a heavier
initial bundle, more blocking CSS or fonts, or an LCP element that the server
no longer renders.

The fixture has no cover images and the stand-in never sends live data, so
the timings are lower than the real-data runs above. Use the check for
regressions, not as the measured result.

## First-load JavaScript

`bun run perf:first-load` (`scripts/perf/first-load.ts`,
`scripts/perf/first-load-budget.ts`) runs in the **Page-load Budget** CI job
after the build. It runs `next experimental-analyze --output`, then for `/`,
`/login`, `/articles` and `/[username]/[slug]`:

1. Sums the gzip size of the route's first-load chunks, as listed by
   `next build` in `.next/diagnostics/route-bundle-stats.json`, and fails when
   it is over the route's budget:

   | Route                | Budget | Measured |
   | -------------------- | -----: | -------: |
   | `/`                  | 210 KB | 199.0 KB |
   | `/login`             | 200 KB | 189.5 KB |
   | `/articles`          | 215 KB | 203.2 KB |
   | `/[username]/[slug]` | 218 KB | 206.6 KB |

   Each budget is the measured size plus 5 to 6 percent: room for ordinary
   changes, not for a new library. A static import of the Stellar SDK,
   Wallets Kit or contract bindings would add tens of kilobytes or more.

2. Lists the source modules in the route's first load from the analyzer's
   data (the bootstrap and render chunk groups; on-demand chunks are left
   out) and fails when any of these is present: `@stellar/*`,
   `@creit.tech/*`, wallet connector packages, `idb`, `idb-keyval` or `dexie`,
   `@ardrive/*` or `arweave`, `@tiptap/*` or `prosemirror-*`, or anything under
   `lib/stellar/v2/`. It also fails when a first-load chunk contains
   `indexedDB`. The analyzer compiles the app again; the check fails if its
   first-load file count differs from the build's, or if its data format
   changes.

The module rule matters even when the budget passes: a deliberate test that
imported `isValidStellarAccountId` (which uses `StrKey` from the SDK) into the
landing demo added only 9 KB after tree-shaking (208.1 KB, under the 210 KB
budget), and the check failed on the four SDK modules it pulled in. Payment
code belongs behind `import()`, `next/dynamic` or `React.lazy`, loaded on the
reader's action.

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

## Writer page rendered on the server (#416)

The production run above was captured before this change. To isolate the
writer page, both versions below are local production builds (`next build`,
then a production server) reading the same local Convex backend, measured on
the same machine. Numbers from a local backend are lower than production for
every page, so compare the two columns, not these values with the tables above.

- **Before:** `overhaul/v2` at `bb32529`. **After:** this change.
- **Page:** a writer with 12 published articles (two pages), signed out.
- **Measurement only:** the production Content Security Policy allows Convex
  only on `*.convex.cloud`, so both builds had the local backend added to
  `connect-src` for these runs. That edit was not committed.

What changed: the server now sends the writer's name, bio and the first page
of articles in the HTML (anonymous reads, the same data any reader sees),
and the browser's live queries take over after loading. The page response also
preloads the two typefaces the writer page uses (`Link` header from
`proxy.ts`). Without that, the titles repainted when the fonts arrived about
1.6 seconds later on throttled mobile, and that repaint set the largest paint.

### `bun run perf:page-load` (5 runs, median)

Same tool and devices as above (throttled mobile: Slow 4G, 4x CPU).

| Writer page | Device  | Load event (ms) | FCP (ms) | LCP (ms) | Network idle (ms) |
| ----------- | ------- | --------------: | -------: | -------: | ----------------: |
| Before      | desktop |              65 |       52 |      140 |               714 |
| After       | desktop |              79 |       76 |       76 |               704 |
| Before      | mobile  |            2216 |      864 |     2616 |              5546 |
| After       | mobile  |            2704 |     1080 |     1080 |              4247 |

### Lighthouse 12.8.2, mobile

| Writer page | Throttling           | Runs | FCP (ms) | LCP (ms) | TBT (ms) |   CLS |
| ----------- | -------------------- | ---: | -------: | -------: | -------: | ----: |
| Before      | applied (`devtools`) |    3 |     1903 |     4958 |       88 | 0.097 |
| After       | applied (`devtools`) |    3 |     2274 |     2274 |        7 |     0 |
| Before      | simulated (default)  |    5 |     1361 |     4213 |       38 | 0.117 |
| After       | simulated (default)  |    5 |     1673 |     3816 |       12 |     0 |

Lighthouse's default simulated mode estimates LCP from every script the page
requested before its observed largest paint. On this streamed page the observed
LCP now equals FCP (117 ms unthrottled), so the simulated LCP overstates it; the
applied-throttling rows load the page on a slowed network and CPU.

### Result

- Throttled mobile LCP fell from 2616 to 1080 ms (`perf:page-load`), under the
  2000 ms goal; the largest paint is now the first paint of real content.
- FCP is later (864 to 1080 ms) because the first paint is now the writer's
  content instead of the loading placeholder, and the load event is later
  because the fonts load up front.
- Re-measure production after deployment with the command in the notes above.
