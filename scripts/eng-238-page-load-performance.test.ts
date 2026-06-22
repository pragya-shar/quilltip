import { describe, expect, it } from 'vitest'

import {
  buildPerformanceReportMarkdown,
  pickArticlePathFromLinks,
  pickProfilePathFromArticlePath,
  summarizeMeasurement,
} from './eng-238-page-load-performance'

describe('ENG-238 page-load performance helper', () => {
  it('picks a real article route from discovered internal links', () => {
    expect(
      pickArticlePathFromLinks([
        '/',
        '/articles',
        '/guide',
        '/pragya',
        '/pragya/test-article-4',
      ])
    ).toBe('/pragya/test-article-4')
  })

  it('derives the profile route from the measured article route', () => {
    expect(pickProfilePathFromArticlePath('/pragya/test-article-4')).toBe(
      '/pragya'
    )
  })

  it('marks pages as passing when the load event is within 2 seconds', () => {
    expect(
      summarizeMeasurement({
        name: 'landing',
        path: '/',
        url: 'http://127.0.0.1:3100/',
        status: 200,
        domContentLoadedMs: 410,
        loadEventMs: 920,
        readyMs: 1100,
        transferSize: 120_000,
        encodedBodySize: 95_000,
        consoleErrors: [],
        failedRequests: [],
      })
    ).toMatchObject({
      targetMet: true,
      targetMetric: 'loadEventMs',
      targetMs: 2000,
    })
  })

  it('formats timing, device, network, and tool evidence in markdown', () => {
    const report = buildPerformanceReportMarkdown({
      capturedAt: '2026-06-11T10:00:00.000Z',
      branch: 'eng-238-Measure-Tranche-2-page-load-performance',
      commit: 'abc123',
      baseUrl: 'http://127.0.0.1:3100',
      environment: {
        device: 'Desktop Chromium, 1280x900 viewport',
        network: 'Local loopback, no throttling',
        tool: 'Playwright Chromium + Navigation Timing API',
      },
      measurements: [
        {
          name: 'landing',
          path: '/',
          url: 'http://127.0.0.1:3100/',
          status: 200,
          domContentLoadedMs: 410,
          loadEventMs: 920,
          readyMs: 1100,
          transferSize: 120_000,
          encodedBodySize: 95_000,
          consoleErrors: [],
          failedRequests: [],
        },
      ],
    })

    expect(report).toContain('# ENG-238 Page-Load Performance Evidence')
    expect(report).toContain('| landing | `/` | 920 | 410 | 1100 | Pass |')
    expect(report).toContain(
      '- **Tool:** Playwright Chromium + Navigation Timing API'
    )
    expect(report).toContain('- **Network:** Local loopback, no throttling')
  })

  it('calls out local Vercel Analytics script noise separately', () => {
    const report = buildPerformanceReportMarkdown({
      capturedAt: '2026-06-11T10:00:00.000Z',
      branch: 'eng-238-Measure-Tranche-2-page-load-performance',
      commit: 'abc123',
      baseUrl: 'http://127.0.0.1:3100',
      environment: {
        device: 'Desktop Chromium, 1280x900 viewport',
        network: 'Local loopback, no throttling',
        tool: 'Playwright Chromium + Navigation Timing API',
      },
      measurements: [
        {
          name: 'landing',
          path: '/',
          url: 'http://127.0.0.1:3100/',
          status: 200,
          domContentLoadedMs: 410,
          loadEventMs: 920,
          readyMs: 1100,
          transferSize: 120_000,
          encodedBodySize: 95_000,
          consoleErrors: [
            "Refused to execute script from 'http://127.0.0.1:3100/_vercel/insights/script.js'",
          ],
          failedRequests: [
            'HTTP 404 http://127.0.0.1:3100/_vercel/insights/script.js',
          ],
        },
      ],
    })

    expect(report).toContain('## Local Environment Notes')
    expect(report).toContain('Vercel Analytics infrastructure noise')
  })
})
