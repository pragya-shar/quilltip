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
| `/`         | 245.4 KB | 208.7 KB |
| `/login`    | 199.2 KB | 199.2 KB |
| `/articles` | 247.6 KB | 213.8 KB |
| Article     | 262.9 KB | 216.7 KB |

The Lighthouse runs above were taken with the toaster loaded on demand
(about 9.7 KB less per route). It went back into the first load after review
(below), so these sizes include it.

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

- **Toasts (reverted):** loading the toaster on demand saved about 9.7 KB per
  route, and Sonner showed toasts raised before it mounted. But its live
  region was then created in the same moment as such a toast, which screen
  readers may not announce, and that could not be checked with a screen
  reader here. The toaster stays in the first load; a test checks that a
  saved profile's toast appears in the `aria-live` region.
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
- **Article page, applied mobile (2098 ms):** resolved by lazy body images
  (1770 ms); see
  [Applied throttling: stylesheet and body images](#applied-throttling-stylesheet-and-body-images-405-428).
  The simulated floor without scripts (2306 ms) remains: its CSS and font
  requests start about 20 ms later in the observed load than on `/articles`;
  not attributed further.
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

## Applied throttling: stylesheet and body images (#405, #428)

Measured 2026-11-27, same method as above (local production builds, seeded
local backend, Lighthouse 12.8.2, five runs, median). Before: `overhaul/v2`
with the first-load change merged (`8768f25`). After: this change.

| Route       | Applied mobile, before | Applied mobile, after | Simulated mobile, before | Simulated mobile, after | Desktop, after | CLS after (mobile / desktop) |
| ----------- | ---------------------: | --------------------: | -----------------------: | ----------------------: | -------------: | ---------------------------: |
| `/`         |                   1919 |                  1841 |                 **3847** |                **3826** |            835 |                0.002 / 0.004 |
| `/login`    |                   1585 |                  1580 |                 **2911** |                **2912** |            620 |                0.016 / 0.000 |
| `/articles` |                   1841 |                  1830 |                 **3814** |                **4048** |            763 |                0.005 / 0.003 |
| Article     |               **2083** |                  1770 |                 **3517** |                **3510** |            700 |                0.000 / 0.001 |

Applied mobile now meets LCP < 2 s on every route, with 159 to 420 ms to
spare. `/articles` simulated mobile moves between about 3810 and 4050 ms from
run to run in both builds (the cover image's timing); the change does not
touch that page's first load.

### Cause

Under applied throttling the page paints when its render-blocking stylesheets
have arrived. They share the Slow 4G connection with the preloaded fonts and,
on the article page, with the body images: the two images of the measured
article (198 KB and 368 KB, far below the first screen) were requested at
about 610 ms, at the same time as the stylesheet, and took two of the six
connections the local server allows. The global stylesheet finished at about
2.0 s and the article painted at 2.08 s.

### What changed

- **Body images load lazily.** The server-rendered article body marks
  images `loading="lazy"` and `decoding="async"`
  (`lib/tiptap/markBodyImagesLazy.ts`), except in the first two top-level
  blocks and in the block that holds the first image when at most 500
  characters of text come before it. Those may be on the first screen or be
  the largest paint (in an article without a cover, an image after a heading
  and a short paragraph often is), so they stay eager. Article applied LCP:
  2083 to 1770 ms.
  - An earlier version kept the first image eager wherever it was. On the
    seeded article, whose first image comes about 7,700 characters after the
    largest paint, that image (198 KB) then loaded with the stylesheet, and
    desktop LCP rose to 848 ms. With the limit it is 545 ms (HTTP/2, five
    runs; simulated mobile did not change).
  - Only images with a stored `width` and `height` reserve their space. The
    writing desk stores them only after a writer resizes an image, so other
    images reserve none, lazy or eager, as before this change. On the seeded
    article, whose images have sizes, scrolling after load shifted nothing
    (CLS 0.000 at 375 and 1440 px).
  - Lazy marking covers the server HTML only. The client body that replaces
    it after load renders every image eagerly, as before, so the gain is in
    the first seconds of the load.
- **The highlight stylesheet left the root layout.** `highlights.css` was
  render-blocking on every page (3.5 KB gzip), and none of its rules apply at
  first paint on these four routes. It now lives in
  `components/highlights/highlights.css` and is imported by the highlight
  components, so it arrives with them (on article pages, during hydration).

### Checked and not changed

- **Splitting the global stylesheet by route.** Rule coverage at first paint,
  at 412 and 1350 px: each route uses 106 to 120 KB of the 144 KB global
  stylesheet (raw), and every rule in it is used by at least one of the four
  routes. Splitting the Tailwind output per route would save at most about
  38 KB raw (about 6 KB gzip) per route, for a restructure of the whole
  stylesheet. `components/articles/reader.css` (about 2.5 KB gzip) is shared
  with skeletons, the writing workspace and profile pages, so it stays global.
- **Font preloads on the article page.** The three preloaded faces are all on
  the first screen at 412 and 1350 px: Syne 600 (title), Work Sans 400 (byline,
  return link) and Alegreya 400 (subtitle, body). None can stop preloading
  without a visible swap after the first paint.

### What simulated mobile under 2 s would need

Superseded by the HTTP/2 measurements in
[Fonts, list data and field data over HTTP/2](#fonts-list-data-and-field-data-over-http2-405-428).

Lighthouse's simulation charges the bytes that finish, and the scripts that
run, before the observed first paint (see
[Why simulated mobile LCP stays above 2 s](#why-simulated-mobile-lcp-stays-above-2-s)).
From the measured runs: the median with today's first load, the "floor" with
the same bytes but scripts delayed past the first paint, and the cost per
kilobyte between the two. The allowance is what keeps LCP at 1900 ms (100 ms
margin).

| Route       | Simulated LCP | Charged before first paint (JS / fonts / CSS / HTML / image), KB | Floor without scripts | ms per KB | Allowed for 1900 ms | What it would take                                                                                                                                                           |
| ----------- | ------------: | ---------------------------------------------------------------: | --------------------: | --------: | ------------------: | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/`         |          3826 |                                          203 / 142 / 42 / 10 / 0 |      1512 ms (112 KB) |       8.1 |             ~160 KB | First paint before the scripts run, and about 35 KB fewer font bytes before first paint. Without scripts the fonts, CSS and HTML alone (194 KB) give about 2180 ms.          |
| `/login`    |          2912 |                                            194 / 44 / 32 / 9 / 0 |       1213 ms (56 KB) |       7.6 |             ~146 KB | Scripts before first paint at most about 60 KB (today 194 KB; Next.js and React alone are larger), or first paint before the scripts run.                                    |
| `/articles` |   3814 – 4048 |                                          207 / 93 / 33 / 28 / 61 |      1815 ms (140 KB) |       7.9 |             ~151 KB | First paint before the scripts run, and about 65 KB fewer font and image bytes before first paint.                                                                           |
| Article     |          3510 |                                          212 / 110 / 29 / 29 / 0 |      2306 ms (117 KB) |       4.6 |                none | Not reachable by trimming: the floor without any scripts is already 2306 ms. Its CSS and font requests start later in the observed load than on `/articles`; not attributed. |

Every row needs the first paint to happen before the page's scripts run in the
unthrottled observed load, which a Next.js page does not control, or a first
load far below the framework's own size. The options that remain are owner
decisions: fewer typefaces on the first screen (the landing page uses ten),
or accepting applied throttling (or field data) as the measure for #405.

## Fonts, list data and field data over HTTP/2 (#405, #428)

Measured 2026-11-27. Targets, all four routes: Lighthouse simulated mobile
LCP < 2 s, applied-throttling mobile LCP < 2 s, CLS < 0.1 (mobile and
desktop). Field data after cutover is the final confirmation (see
[Field data](#field-data)).

### Method: HTTP/2, as production serves the site

Same builds, data and tool as above (local production build, seeded local
backend, Lighthouse 12.8.2, five runs, median), with one change: Lighthouse
now loads the pages over HTTP/2 and TLS, through a local proxy in front of
`next start`. `next start` itself speaks HTTP/1.1, and the protocol changes
both lab methods:

- **Simulated:** Lighthouse models connections from the observed protocol.
  Over HTTP/1.1 it allows six connections per host and queues the page's
  20 or so chunk requests behind each other, each extra round costing a
  simulated 150 ms round trip. That queueing does not exist on the deployed
  site, which serves HTTP/2. On the same build, HTTP/2 lowered simulated LCP
  by 650 to 800 ms (login 2918 to 2105 ms, article 3510 to 2706 ms).
- **Applied:** DevTools throttling shares the bandwidth equally between
  requests in flight. Over HTTP/1.1 only six run at once, so the stylesheet
  and fonts were never competing with the scripts; over HTTP/2 all of them
  start together and the low-priority scripts take bandwidth from the
  stylesheet. Applied LCP rose by 400 to 750 ms.

HTTP/2 is the protocol readers get, so every number in this section uses it.
The tables earlier on this page (HTTP/1.1) are not comparable with these.

### Cause

On every route the page paints when its stylesheets have arrived, and its
async chunk scripts (190 to 207 KB gzip, about 145 KB of it React and the
Next.js router) work against that in both methods:

- On the unthrottled load Lighthouse records, Chrome runs every chunk script
  before it presents the first frame, so the simulation charges all of their
  bytes and evaluation to LCP.
- Under applied throttling the scripts download alongside the stylesheet and
  fonts and slow them down.

Next.js 16.4 has no setting for when these scripts load: the App Router
writes the root chunks through `ReactDOM.preinit` and React writes every other
chunk as a hoisted `<script async>` (checked in the installed
`next/dist/server/app-render/required-scripts.js` and the App Router runtime).

The change that takes the chunk scripts off the paint path edits the Next.js
runtime. It is proposed in a separate pull request, stacked on this one, so
the changes below can merge without it.

### What changed

Medians of five runs, LCP in ms, HTTP/2. Each row adds one change to the
previous row.

| Step                                    | `/` sim. | `/login` sim. | `/articles` sim. | Article sim. | `/` applied | `/login` applied | `/articles` applied | Article applied |
| --------------------------------------- | -------: | ------------: | ---------------: | -----------: | ----------: | ---------------: | ------------------: | --------------: |
| Before (#506 merged with `overhaul/v2`) |     2779 |          2105 |             2854 |         2859 |        2593 |             2214 |                2814 |            2565 |
| 1. Fonts                                |     2857 |          2105 |             2860 |         2704 |        2596 |             2209 |                2792 |            2563 |
| 2. `/articles` card data                |     2857 |          2255 |             2705 |         2855 |        2680 |             2264 |                3030 |            2637 |

Row 2 is the whole branch, measured again on one build after a merge of
`overhaul/v2` (#498, #530) and the review fixes of #503 and #506, which put
the toaster back in every first load (about 10 KB). Changes on routes the
card data does not touch (`/login` simulated 2105 to 2255 ms) are likely
from those; they were not measured separately.

1. **Fonts.** Every face was rewritten losslessly to WOFF2 without glyph
   names (19 KB less in total; the two `.woff` files became WOFF2), and
   each typeface got a metric-matched fallback (`app/font-fallbacks.css`:
   size, ascent and descent overrides computed the way `next/font` computes
   them, one face per weight). Text that paints before its web font now keeps
   its line breaks when the font swaps in; CLS fell on `/` (0.002 to 0.001)
   and `/articles` (0.005 to 0.000). LCP changed within noise.
   - Faces at weight 600 and above use Arial Bold as their source, with
     values computed against Arial Bold. With `local('Arial')` at 600, WebKit
     draws Arial Bold and Chromium draws regular Arial made bold, so values
     computed against regular Arial made Syne headings wider in WebKit: an
     article title took 3 lines with the fallback and 2 with Syne, and the
     text below it moved up by about 38 px per heading at the swap.
   - Liberation Sans and Liberation Serif are listed after Arial and Times New
     Roman. They have the same advance widths, so the same values hold on
     systems that have only them, such as most Linux systems. WebKit on Linux
     resolves only the regular ones (see below).
   - Each fallback face matches the file its family draws at that weight.
     Syne has three files (400, 600, 700). `Landing Syne` and the sign-in
     pages' `Account Syne` have one face per file, so 500 draws the 400 file:
     they use `Syne Fallback`. `Quilltip Display`, `Reader`, `Reading Room`,
     `Library`, `Writing` and `Wallet Syne`, and the account pages'
     `Account Syne`, draw the 600 file at every weight: they use
     `Syne 600 Fallback`. Before this split, the `/guide` wallet button
     (`Landing Syne` 500) was 311 px in the fallback against 275 px in Syne
     and took two lines until the font arrived.
   - `bun run perf:font-fallbacks` checks this. See
     [Font fallback check](#font-fallback-check).
2. **`/articles` sends card data, not article bodies.** The first list in
   the HTML carried every listed article's full document and search text
   (the long article's text 40 times). The server now sends each card its
   opening (`lib/articles/listArticleForClient.ts`); the card text is the
   same (unit test), and the live query brings full rows after load. The
   page's HTML fell from 160 KB to 49 KB raw (26.6 to 10.3 KB gzip).

### Result

Median of 5; CLS is the largest median across the simulated, applied and
desktop runs.

| Route       | Simulated mobile LCP | Applied mobile LCP | Desktop LCP |   CLS | Simulated < 2 s | Applied < 2 s | CLS < 0.1 |
| ----------- | -------------------: | -----------------: | ----------: | ----: | --------------- | ------------- | --------- |
| `/`         |                 2857 |               2680 |         586 | 0.001 | no              | no            | yes       |
| `/login`    |                 2255 |               2264 |         486 | 0.016 | no              | no            | yes       |
| `/articles` |                 2705 |               3030 |         526 | 0.001 | no              | no            | yes       |
| Article     |                 2855 |               2637 |         545 | 0.001 | no              | no            | yes       |

CLS is met everywhere; neither LCP target is met on any route. The chunk
scripts are the cause on all four routes (see [Cause](#cause-1)), and the
first load cannot shrink enough to change that (see
[Checked and not changed](#checked-and-not-changed-1)).

`/articles` applied LCP (3030 ms) is higher than in the earlier runs on this
page (2792 to 2814 ms). This build also has the toaster back in the first
load (#503 review) and the `overhaul/v2` merges; the difference is not
attributed.

### Checked and not changed

- **JavaScript content.** The first load is React DOM (about 62 KB gzip),
  the Next.js router and runtime (about 85 KB), the Convex client (about
  23 KB) and 15 to 40 KB of app code per route. Public pages need the Convex
  client for live data, and the app code is the page's own, so no route
  can drop enough of it to bring simulated LCP under 2 s. What can change is
  when it runs (the separate pull request). `convex/_generated/api.js` pulls
  Convex's schema helpers into the browser (about 1.7 KB); generated code is
  left as it is.
- **Splitting the global stylesheet.** `experimental.cssChunking: 'graph'`
  produced the same stylesheets for these routes (one global sheet from
  `app/globals.css`). Rule coverage shows 74 to 83 percent of it used at
  first paint on each route; a hand split would save at most about 6 KB gzip.
- **Variable fonts.** A Syne variable file is 34.6 KB against 41.7 KB for
  the three static weights, and larger wherever a page needs only one or two
  weights before paint.
- **Font preloads and swap.** With `font-display: swap`, Chrome does not
  report a new LCP when a web font replaces the fallback (tested), so a late
  font does not move LCP; the preloads stay because every preloaded face is
  on its route's first screen.
- **Article HTML order.** The head carries the font preloads and stylesheets
  first; the LCP paragraph starts about 9 KB into the 98 KB (raw) document,
  before the hydration data.
- **The article's later CSS and font requests** seen in the earlier
  script-delay experiment came from that experiment's proxy; in direct loads
  the article requests them at 14 ms, like `/articles` (13 ms).

### Landing typefaces: proposal for the owner

The landing page loads ten font files (169 KB). Three of them can be
replaced by faces the page already loads:

| Face                | Size  | First screen                              | Replacement     |
| ------------------- | ----- | ----------------------------------------- | --------------- |
| DM Sans 400         | 14 KB | The two hero buttons                      | Work Sans 400   |
| DM Sans 700         | 14 KB | none (below the fold)                     | Work Sans 600   |
| Literata 600 italic | 22 KB | The handwritten "writing" in the headline | Alegreya italic |

With all three replaced the page loads seven files (120 KB). Measured with
the chunk-script change from the separate pull request in place: simulated
mobile LCP 1803 ms against 1804 ms, applied 1815 ms against 1829 ms. **The change is visible (the
headline's handwritten word becomes lighter, and the buttons change face)
and brings no measurable LCP gain, so the recommendation is to keep the
ten faces.** Screenshots at 375 and 1440 px are in the report for #405.

### Field data

Real-visit page speed is recorded only where product analytics is enabled
(`NEXT_PUBLIC_ANALYTICS_ENABLED=true` and `ANALYTICS_POSTHOG_KEY` set) and
only after a visitor allows analytics; it is off locally and by default.
After consent, `components/analytics/WebVitalsReporter.tsx` (loaded on
demand, not in any first load) sends one `web_vital` event per measure
through the existing same-origin relay (`/api/analytics`). Each event carries
fixed values only (`lib/analytics/webVitals.ts`):

| Property | Values                                                                                                                           |
| -------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `metric` | `LCP`, `CLS`, `INP`, `FCP`, `TTFB`                                                                                               |
| `rating` | `good`, `needs-improvement`, `poor` (the web-vitals thresholds)                                                                  |
| `band`   | timing: `<1000`, `1000-1499`, `1500-1999`, `2000-2499`, `2500-3999`, `>=4000` ms; INP `<200` to `>=500`; CLS `<0.05` to `>=0.25` |
| `route`  | `landing`, `login`, `articles`, `article`, `other`                                                                               |
| `device` | `mobile` (viewport under 768 px), `desktop`                                                                                      |

To read it in PostHog: Insights, event `web_vital`, filter `metric = LCP`
(or `CLS`), break down by `route` and `band`, and split by `device`. The
target holds on a route when at least 75 percent of its mobile LCP events
fall in bands under 2000 ms (`<1000`, `1000-1499`, `1500-1999`), and 75
percent of its CLS events in `<0.05` or `0.05-0.099`. The privacy page says
that page-speed ratings are recorded with consent.

## Chunk scripts after the first paint (#405, #428)

Measured 2026-11-27 with the method of the previous section (HTTP/2, five
runs, median), on one build of `dcfae16`: "without" is the same build with
`QUILLTIP_HYDRATE_AFTER_PAINT=false`, so the four routes render with
Next.js's own scripts. `patches/next@16.4.6.ts` makes the four routes start
their Next.js chunk scripts after the first contentful paint; how it works,
its checks, and how to upgrade or remove it are in
[next-patch.md](next-patch.md).

### Result

LCP in ms, without → with the patch.

| Route       | Simulated mobile | Applied mobile |   Desktop | CLS (max) | Simulated < 2 s | Applied < 2 s | CLS < 0.1 |
| ----------- | ---------------: | -------------: | --------: | --------: | --------------- | ------------- | --------- |
| `/`         |      2857 → 1804 |    2701 → 1839 | 572 → 404 |     0.000 | yes             | yes           | yes       |
| `/login`    |      2255 → 1203 |    2282 → 1501 | 484 → 323 |     0.016 | yes             | yes           | yes       |
| `/articles` |      2705 → 1654 |    2976 → 1865 | 524 → 363 |     0.001 | yes             | yes           | yes       |
| Article     |      2854 → 1803 |    2931 → 1743 | 529 → 364 |     0.001 | yes             | yes           | yes       |

The applied medians meet 2 s with small margins. Runs over 2 s with the
patch: `/` two of five (2125 and 2167 ms), `/articles` two of five (2119 and
2129 ms), the article page one of five (2034 ms). Simulated runs varied by
2 ms at most.

The loader now runs in `<head>` before the first paint (next-patch.md). That
did not move LCP: the earlier build with a late, async loader measured
1811 / 1212 / 1657 / 1805 ms simulated.

**Immutable assets (Vercel).** Vercel serves chunks from
`/_next/static/immutable/chunks/`; the patch handles both paths. A local
build with `experimental.supportsImmutableAssets` writes 10 inert tags and no
early chunk script on each of the four routes, and passes the browser suite in
three engines. Simulated mobile LCP on that build, off → on, measured with the
two modes interleaved on a heavily loaded machine (load average 19 to 84 on
18 cores), so exploratory: `/` 2860 → 1810, `/login` 2280 → 1211,
`/articles` 2707 → 1656, the article page 2855 → 1830 (one pair). The applied
runs on that machine (for example `/` 3385 → 2278) are not comparable with the
table above.

### Cost: later hydration and more waiting

The scripts start when the page has painted instead of alongside the
stylesheet, so every control that needs JavaScript becomes ready later.

Slow 4G and 4x CPU (Lighthouse's mobile values, applied through the
DevTools protocol), HTTP/2, 375 px wide (the account menu at 1280 px,
signed in), same build off and on. "Ready" is the time after navigation
start at which React handles the control; median of 5.

| Control ready (ms)                   |  Off |   On | Later by |
| ------------------------------------ | ---: | ---: | -------: |
| `/`: "Add a tip"                     | 3055 | 4126 |     1071 |
| `/articles`: mobile menu             | 2974 | 3903 |      929 |
| Article: mobile menu                 | 3019 | 3893 |      874 |
| `/login`: sign-in form               | 2665 | 3424 |      759 |
| Article: "Tip article"               | 6017 | 7016 |      999 |
| `/articles`, signed in: account menu | 4470 | 5380 |      910 |

An independent review on the earlier build measured 0.5 to 1.7 s later on
the same profile (for example the `/articles` menu 3122 → 4763 ms). Both sets
agree that every control is ready later; the size depends on the machine.

A tap the moment the control appears on screen, median of 10 (ms after
navigation start for "appears", ms after the tap for "answered"):

| Control                 | Off: appears, answered | On: appears, answered | Lost, off / on |
| ----------------------- | ---------------------: | --------------------: | -------------- |
| `/articles` mobile menu |              3019, 865 |            1915, 2874 | 0 / 0          |
| `/`: "Add a tip"        |             2972, 8210 |            1913, 3371 | 0 / 0          |
| `/login`: "Log in"      |             2419, lost |            1911, 2834 | 10 / 0         |

- With the patch the page appears about 1 s sooner, and no early tap is lost:
  the loader holds it from the first paint and replays it once React has
  hydrated the control. The earlier build lost a tap made between the first
  paint and the loader's arrival (the review measured 5 of 5 on the menus
  and "Add a tip").
- The `/articles` menu answers later on the clock (4.8 s against 3.9 s after
  navigation). "Add a tip" answers sooner (5.3 s against 11.2 s). Without the
  patch, a sign-in sent before hydration is posted by the browser itself and
  shows no result.

Lighthouse, median of 5 (ms):

| Route       | TBT simulated | TBT applied | TTI simulated |   TTI applied |
| ----------- | ------------: | ----------: | ------------: | ------------: |
| `/`         |        12 → 8 |   129 → 143 |   3177 → 3179 | 4249 → 10643¹ |
| `/login`    |        23 → 3 |     13 → 13 |   2255 → 1651 |   2626 → 3390 |
| `/articles` |         6 → 4 |     67 → 23 |   2714 → 2106 |   3156 → 4163 |
| Article     |       37 → 31 |   297 → 118 |   5409 → 5476 |   6853 → 6827 |

- ¹ The landing page's opening intro ends with a long task at about 10.5 s
  in both builds. With the patch, prefetches after hydration end later, so
  Lighthouse's 5-second quiet window closes only after that task, and it
  counts toward TTI. The review measured the same: 4.2 to 10.7 s.
- Applied TTI is about 0.8 to 1.0 s later on `/login` and `/articles`, as
  hydration is.
- Field data (INP, and how readers use the controls) after cutover shows
  whether readers notice the later hydration.

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
   | Scripts referenced by the server HTML        | 230 KB |         216 KB |
   | Render-blocking stylesheets                  |      4 |              3 |
   | Chunk scripts loaded before the first paint  |      0 |              0 |
   | CLS (median of 3)                            |    0.1 |          0.016 |
   | LCP element in the server HTML (2 of 3 runs) |    yes |            yes |
   | LCP image URL in the server HTML (2 of 3)    |    yes |            yes |

   Each route also has its own budgets for the server HTML, its stylesheets
   and its fonts, set a little above the measured size, so one more font
   face (the smallest is 12 KB), a larger stylesheet or a list that embeds
   more data fails. Raise a budget in the change that needs it.

   | Route       | Server HTML (uncompressed) | Stylesheets | Fonts (larger of mobile and desktop) |
   | ----------- | -------------------------: | ----------: | -----------------------------------: |
   | `/`         |                 42 (38) KB |  41 (39) KB |                         172 (169) KB |
   | `/login`    |                 34 (30) KB |  31 (29) KB |                           42 (39) KB |
   | `/articles` |                 48 (44) KB |  31 (29) KB |                           82 (79) KB |
   | Article     |                 44 (40) KB |  28 (26) KB |                          101 (98) KB |

   Budget, then the measured size in brackets. The HTML budget is
   uncompressed because repeated data compresses well: on `/articles`,
   sending every article's full document and search text again (without
   `listArticleForClient`) takes the fixture page's HTML from 44 to 68 KB (8 to 10 KB gzip), and the check fails.
   The fixture articles carry search text, as real rows do.

   Other bytes are compressed sizes as served by `next start`. Which element the
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

### Font fallback check

`bun run perf:font-fallbacks` (`scripts/perf/font-fallback-check.ts`) uses the
same build and fixture backend as `perf:budget`. For `/`, `/login`,
`/articles`, the article page and `/guide`, in Chromium and WebKit, at 375 and
1440 px, it loads the page twice: once with every font request blocked, so
text stays in the fallback faces, and once with the web fonts loaded. It
fails when:

1. a text element names a fallback family (`... Fallback`) that has no font
   face for its weight;
2. for a font (family, weight and style) set in a fallback stack, the page's
   text in that font is more than 7% wider or narrower in the fallback face.
   Each element's width is the sum of its line pieces, so it does not depend
   on where lines break, and fonts with fewer than 30 characters on the page
   are skipped;
3. a heading (`h1` to `h3`) anywhere on the page changes its height, that is
   its number of lines;
4. on the first 1.5 screens, the 90th percentile of the text blocks' vertical
   movement is over 4 px. Positions are layout positions (`offsetTop`), so
   transforms and animations do not count. One case is exempt, by name, with
   its reason: `/guide` at 375 px (below).

Rule 2 is what the faces control. On the fixture build, over 13 routes in
three engines, matched faces measured 0.985 to 1.051. A face matched to the
wrong file measured 0.879 to 0.891 (`Wallet` and `Reading Room Syne` with the
shared fallback) or 1.148 to 1.168 (`Landing Syne` 500 with the 600-file
values), and the earlier bold values measured 1.076 to 1.111 in WebKit. The
landing headline in `Landing Literata` italic is split into single letters
and has fewer than 30 characters per font, so it is skipped.

Rule 4 is needed as well: a face a few percent too wide passes rule 2 while
text in view moves. With `Syne Fallback` 400 to 500 made 5% wider, `/login`
at 375 px measures 1.067 and moves 22 px in Chromium and WebKit; rule 4 fails it there, and rule 2 fails
only `/login` at 1440 px (1.074).

**Trade-off on `/guide` at 375 px.** There, text in view moves 26 px at the
swap, against 0 px on `overhaul/v2`, which has no fallback faces. The cause is
the "Send 1 test XLM…" paragraph: its text is 663 px wide in Work Sans and
669 px in the matched fallback, in a 335 px box, so it takes two lines in
Work Sans and three in the fallback. This happens in Chromium, WebKit and
Firefox. All Work Sans 400 text on that page is 1.02 times as wide in its
fallback, within rule 2; a line that is already almost full can wrap in a
face 1% wider, and no face values rule that out for every text. The check
reports this case and does not gate it (`MOVEMENT_EXEMPT`). `/guide` at
1440 px is gated.

Results on the fixture build, five gated routes, Chromium, WebKit and Firefox:
the check passes, no heading changes lines, and the worst font measures 0.993
to 1.027. Text in view moves 0 px everywhere (Firefox: at most 2 px) except
`/guide` at 375 px (26 px, the paragraph above). The same build with
`PERF_FONT_ROUTES="/support /terms /contact /privacy /register /welcome
/wallet/practice /library"` also passes. `/support` and `/contact` at 1440 px,
`/terms` and `/wallet/practice` at 375 px still move 26 to 56 px at the swap,
with every font within 5.1%. Pages added with `PERF_FONT_ROUTES` are checked
on rules 1 to 3; their movement is only reported.

Deliberate breaks, each failing the check:

- `Syne 600 Fallback` stacks sent back to `Syne Fallback`: `Wallet Syne` and
  `Reading Room Syne` 400 at 0.879 to 0.891, in Chromium and WebKit.
- The `Syne Fallback` 500 face with the 600-file values: `Landing Syne` 500 at
  1.148 to 1.168 on `/` and `/guide`.
- Bold faces with the earlier values and `local('Arial')`: WebKit fails on
  `/` and `/guide`, bold Syne, DM Sans and Work Sans at 1.076 to 1.111.
  Chromium passes, as before the fix.
- No fallback faces (the `@import` removed): 88 missing faces and 38 fonts
  off by 8 to 25% (0.883 to 1.253), across both engines.

CI runs it as the **Font Fallbacks** job on a macOS runner, which has Arial
and Times New Roman, as Safari readers do. On the Linux runner it failed for
reasons that say little about those browsers:

- WebKit on Linux leaves the bold faces in `error`: it does not resolve the
  full face names (`Arial Bold`, `Liberation Sans Bold`), so bold text falls
  through to the generic sans-serif. The regular faces, named by family,
  resolve.
- Chromium on Linux resolves every face, but one `/articles` heading and one
  `/login` block still changed at the swap. The cause was not investigated;
  Linux text rendering differs from macOS.

When the check fails, it lists each fallback face's status (`loaded`,
`unloaded` or `error`), so a runner without the expected fonts shows.

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
   | `/`                  | 214 KB | 211.8 KB |
   | `/login`             | 204 KB | 202.3 KB |
   | `/articles`          | 218 KB | 216.1 KB |
   | `/[username]/[slug]` | 222 KB | 219.9 KB |

   The sizes include the chunk loader of the Next.js patch
   (`public/hydrate-after-paint.js`, 2.4 KB gzip), which every route loads
   once: its `<head>` tag and its bootstrap tag share one URL.

   Each budget is the measured size plus about 2 KB (CI measures about
   0.2 KB more than a local build), so removing a lazy boundary (the mobile
   menu, the account menu) or a few KB of growth fails; raise a budget in the
   change that needs it. A size failure lists the route's ten largest
   first-load modules.

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
landing demo added only 9 KB after tree-shaking (208.1 KB, under the budget
of 210 KB at the time), and the check failed on the four SDK modules it pulled
in. Payment
code belongs behind `import()`, `next/dynamic` or `React.lazy`, loaded on the
reader's action.

## Re-run

Measure over HTTP/2 (`scripts/perf/http2-proxy.ts` describes the setup), as
the deployed site is served; `next start` alone speaks HTTP/1.1.

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
