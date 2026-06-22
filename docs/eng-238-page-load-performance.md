# ENG-238 Page-Load Performance Evidence

- **Captured:** 2026-06-11T15:40:45.642Z
- **Branch:** eng-238-Measure-Tranche-2-page-load-performance
- **Commit:** a74410c
- **Base URL:** http://127.0.0.1:3100
- **Device:** Desktop Chromium, 1280x900 viewport
- **Network:** Local loopback, no throttling
- **Tool:** Playwright Chromium + Navigation Timing API
- **Target:** load event at or under 2000 ms

## Measurements

| Page              | Path                     | Load event (ms) | DOM content loaded (ms) | Ready (ms) | Target |
| ----------------- | ------------------------ | --------------: | ----------------------: | ---------: | ------ |
| landing           | `/`                      |              45 |                      18 |        636 | Pass   |
| article           | `/pragya/test-article-4` |             113 |                      15 |        659 | Pass   |
| profile/dashboard | `/pragya`                |             141 |                      14 |        683 | Pass   |

## Console And Network Watch

### landing (`/`)

- HTTP status: 200
- Transfer size: 6321 bytes
- Encoded body size: 6021 bytes
- Console errors:
  - Failed to load resource: the server responded with a status of 404 (Not Found)
  - Refused to execute script from 'http://127.0.0.1:3100/_vercel/insights/script.js' because its MIME type ('text/html') is not executable, and strict MIME type checking is enabled.
- Failed or >=400 requests:
  - HTTP 404 http://127.0.0.1:3100/_vercel/insights/script.js
  - GET http://127.0.0.1:3100/_vercel/insights/script.js net::ERR_ABORTED

### article (`/pragya/test-article-4`)

- HTTP status: 200
- Transfer size: 6976 bytes
- Encoded body size: 6676 bytes
- Console errors:
  - Failed to load resource: the server responded with a status of 404 (Not Found)
  - Refused to execute script from 'http://127.0.0.1:3100/_vercel/insights/script.js' because its MIME type ('text/html') is not executable, and strict MIME type checking is enabled.
- Failed or >=400 requests:
  - HTTP 404 http://127.0.0.1:3100/_vercel/insights/script.js
  - GET http://127.0.0.1:3100/_vercel/insights/script.js net::ERR_ABORTED

### profile/dashboard (`/pragya`)

- HTTP status: 200
- Transfer size: 7899 bytes
- Encoded body size: 7599 bytes
- Console errors:
  - Failed to load resource: the server responded with a status of 404 (Not Found)
  - Refused to execute script from 'http://127.0.0.1:3100/_vercel/insights/script.js' because its MIME type ('text/html') is not executable, and strict MIME type checking is enabled.
- Failed or >=400 requests:
  - HTTP 404 http://127.0.0.1:3100/_vercel/insights/script.js
  - GET http://127.0.0.1:3100/_vercel/insights/script.js net::ERR_ABORTED

## Local Environment Notes

- `/_vercel/insights/script.js` returned 404 under local `next start`; this is Vercel Analytics infrastructure noise for the local production server, not a page rendering blocker in the measured app routes.

## Fix Decision

No measured page missed the under-2-second load-event target in this run, so ENG-238 did not require an avoidable performance fix.
