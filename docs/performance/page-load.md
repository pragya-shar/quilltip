# Page-Load Performance

- **Captured:** 2026-11-25T17:30:39.518Z
- **Commit:** bbb7d82 (Vercel production deployment of main)
- **Base URL:** https://www.quilltip.me
- **Tool:** Playwright chromium (headless) with Navigation Timing, Paint Timing and LCP APIs
- **Runs:** 3 cold loads per page and device; tables show the median
- **Goal:** median load event, largest contentful paint (LCP) and, where measured, content ready all at or under 2000 ms
- **Content ready:** time until the page can be used: the landing intro has finished, or the dashboard stats have loaded

## Devices and networks

- **desktop:** Desktop Chromium, 1280x900 viewport; Unthrottled connection from the measuring machine
- **mobile:** Mobile emulation, 375x812 viewport, 2x DPR, touch; Slow 4G (150 ms RTT, 1.6 Mbps down, 750 kbps up), 4x CPU slowdown

## Desktop

| Page      | Path                                              | Load event (ms) | FCP (ms) | LCP (ms) | Content ready (ms) | DOM content loaded (ms) | Network idle (ms) | Goal |
| --------- | ------------------------------------------------- | --------------: | -------: | -------: | -----------------: | ----------------------: | ----------------: | ---- |
| landing   | `/`                                               |             223 |      148 |      148 |               6558 |                     151 |              6559 | Over |
| article   | `/q6da1413b91a046bf95c/she-signed-for-a-postcard` |            1106 |     1112 |     1208 |                n/a |                    1050 |              2735 | Pass |
| profile   | `/q6da1413b91a046bf95c`                           |             782 |      644 |      644 |                n/a |                     654 |              1410 | Pass |
| dashboard | `/dashboard`                                      |             142 |      120 |     1272 |               1495 |                     107 |              1497 | Pass |

## Throttled mobile

| Page      | Path                                              | Load event (ms) | FCP (ms) | LCP (ms) | Content ready (ms) | DOM content loaded (ms) | Network idle (ms) | Goal |
| --------- | ------------------------------------------------- | --------------: | -------: | -------: | -----------------: | ----------------------: | ----------------: | ---- |
| landing   | `/`                                               |            5250 |     1992 |     1992 |              10080 |                    1928 |             10081 | Over |
| article   | `/q6da1413b91a046bf95c/she-signed-for-a-postcard` |            5365 |     3168 |     5436 |                n/a |                    3108 |              7179 | Over |
| profile   | `/q6da1413b91a046bf95c`                           |            2711 |     2456 |     4468 |                n/a |                    2432 |              6038 | Over |
| dashboard | `/dashboard`                                      |            2187 |     1888 |     3356 |               3527 |                    1872 |              5291 | Over |

## Console and network watch

### landing (`/`, desktop)

- HTTP status: 200
- Final path: `/`
- Document transfer size (median): 9227 bytes
- Console errors:
  - None
- Failed or >=400 requests:
  - None

### article (`/q6da1413b91a046bf95c/she-signed-for-a-postcard`, desktop)

- HTTP status: 200
- Final path: `/q6da1413b91a046bf95c/she-signed-for-a-postcard`
- Document transfer size (median): 10369 bytes
- Console errors:
  - None
- Failed or >=400 requests:
  - None

### profile (`/q6da1413b91a046bf95c`, desktop)

- HTTP status: 200
- Final path: `/q6da1413b91a046bf95c`
- Document transfer size (median): 6055 bytes
- Console errors:
  - None
- Failed or >=400 requests:
  - None

### dashboard (`/dashboard`, desktop)

- HTTP status: 200
- Final path: `/dashboard/stats`
- Document transfer size (median): 3634 bytes
- Console errors:
  - None
- Failed or >=400 requests:
  - None

### landing (`/`, mobile)

- HTTP status: 200
- Final path: `/`
- Document transfer size (median): 9227 bytes
- Console errors:
  - None
- Failed or >=400 requests:
  - None

### article (`/q6da1413b91a046bf95c/she-signed-for-a-postcard`, mobile)

- HTTP status: 200
- Final path: `/q6da1413b91a046bf95c/she-signed-for-a-postcard`
- Document transfer size (median): 10369 bytes
- Console errors:
  - None
- Failed or >=400 requests:
  - None

### profile (`/q6da1413b91a046bf95c`, mobile)

- HTTP status: 200
- Final path: `/q6da1413b91a046bf95c`
- Document transfer size (median): 6055 bytes
- Console errors:
  - None
- Failed or >=400 requests:
  - None

### dashboard (`/dashboard`, mobile)

- HTTP status: 200
- Final path: `/dashboard/stats`
- Document transfer size (median): 3634 bytes
- Console errors:
  - None
- Failed or >=400 requests:
  - None

## Notes

- `/dashboard` redirects in the browser to `/dashboard/stats`; its timings cover that redirect, and LCP covers the stats content.
- Every run is a first visit, so the landing page plays its opening animation (about 6.2 s, skippable, once per browser session, not shown with reduced motion). The page stays inert until it ends, so landing content ready includes it; the page itself paints in under 2 s. Visitors who scroll or swipe jump to the last 2.1 s of the intro, and Escape or Skip ends it; the intro is kept as designed.
- The dashboard was measured with a new test account that has no articles or tips, so its stats are empty; an active writer's dashboard loads more data.
- Production was serving `bbb7d82` (latest successful Vercel production deployment), which includes the server-rendered article and profile pages from #383. This run is the re-measurement after #383.
- Compared with ENG-238 (localhost, no throttling, load event 45 to 141 ms), these numbers include real network round trips; throttled mobile also slows the CPU 4x.
- Re-run with `bun run perf:page-load -- --commit <deployed sha> --auth-state <file outside the repo>`; create the session file with `--login` and a test account.

## Result

These pages missed the 2000 ms goal in this run:

- landing (`/`, desktop): median content ready 6558 ms is above 2000 ms
- landing (`/`, mobile): median content ready 10080 ms is above 2000 ms
- article (`/q6da1413b91a046bf95c/she-signed-for-a-postcard`, mobile): median LCP 5436 ms is above 2000 ms
- profile (`/q6da1413b91a046bf95c`, mobile): median LCP 4468 ms is above 2000 ms
- dashboard (`/dashboard`, mobile): median content ready 3527 ms is above 2000 ms

Follow-up: #405 covers the slow pages.

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
