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
