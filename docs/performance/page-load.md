# Page-Load Performance

- **Captured:** 2026-11-25T17:21:21.872Z
- **Commit:** bbb7d82 (origin/main when measured)
- **Base URL:** https://www.quilltip.me
- **Tool:** Playwright chromium (headless) with Navigation Timing, Paint Timing and LCP APIs
- **Runs:** 3 cold loads per page and device; tables show the median
- **Goal:** median load event, largest contentful paint (LCP) and, where measured, content ready all at or under 2000 ms
- **Content ready:** time until data-driven content appears (measured for the dashboard, whose stats render after client data loads)

## Devices and networks

- **desktop:** Desktop Chromium, 1280x900 viewport; Unthrottled connection from the measuring machine
- **mobile:** Mobile emulation, 375x812 viewport, 2x DPR, touch; Slow 4G (150 ms RTT, 1.6 Mbps down, 750 kbps up), 4x CPU slowdown

## Desktop

| Page      | Path                                              | Load event (ms) | FCP (ms) | LCP (ms) | Content ready (ms) | DOM content loaded (ms) | Network idle (ms) | Goal |
| --------- | ------------------------------------------------- | --------------: | -------: | -------: | -----------------: | ----------------------: | ----------------: | ---- |
| landing   | `/`                                               |             220 |      164 |      164 |                n/a |                     125 |              1032 | Pass |
| article   | `/q6da1413b91a046bf95c/she-signed-for-a-postcard` |             913 |      784 |      784 |                n/a |                     841 |              2568 | Pass |
| profile   | `/q6da1413b91a046bf95c`                           |             802 |      680 |      772 |                n/a |                     660 |              1426 | Pass |
| dashboard | `/dashboard`                                      |             145 |      140 |     1188 |               1452 |                     115 |              1453 | Pass |

## Throttled mobile

| Page      | Path                                              | Load event (ms) | FCP (ms) | LCP (ms) | Content ready (ms) | DOM content loaded (ms) | Network idle (ms) | Goal |
| --------- | ------------------------------------------------- | --------------: | -------: | -------: | -----------------: | ----------------------: | ----------------: | ---- |
| landing   | `/`                                               |            5173 |     1988 |     1988 |                n/a |                    1976 |              5574 | Over |
| article   | `/q6da1413b91a046bf95c/she-signed-for-a-postcard` |            5441 |     3268 |     5512 |                n/a |                    3215 |              7233 | Over |
| profile   | `/q6da1413b91a046bf95c`                           |            2727 |     2480 |     4368 |                n/a |                    2447 |              6005 | Over |
| dashboard | `/dashboard`                                      |            2178 |     1888 |     3328 |               3528 |                    1866 |              5223 | Over |

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
- The dashboard was measured with a new test account that has no articles or tips, so its stats are empty; an active writer's dashboard loads more data.
- Production was serving `bbb7d82` (Vercel production deployment of `main`), which includes the server-rendered article and profile pages from #383. This run is the re-measurement after #383.
- Compared with ENG-238 (localhost, no throttling, load event 45 to 141 ms), these numbers include real network round trips; throttled mobile also slows the CPU 4x.
- Re-run with `bun run perf:page-load -- --auth-state <file outside the repo>`; create the file with `--login` and a test account.

## Result

These pages missed the 2000 ms goal in this run:

- landing (`/`, mobile): median load event 5173 ms is above 2000 ms
- article (`/q6da1413b91a046bf95c/she-signed-for-a-postcard`, mobile): median LCP 5512 ms is above 2000 ms
- profile (`/q6da1413b91a046bf95c`, mobile): median LCP 4368 ms is above 2000 ms
- dashboard (`/dashboard`, mobile): median content ready 3528 ms is above 2000 ms

Follow-up: #405 covers all four pages.
