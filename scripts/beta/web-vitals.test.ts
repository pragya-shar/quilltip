import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import {
  WEB_VITAL_BANDS,
  webVitalProperties,
  webVitalRoute,
} from '../../lib/analytics/webVitals'

const ID = '0b7e3a52-8c1f-4d2e-9a6b-3f4c5d6e7f80'
const upstream = vi.fn(async () => new Response(null, { status: 200 }))

beforeEach(() => {
  upstream.mockClear()
  vi.stubGlobal('fetch', upstream)
})
afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

test('page kinds come from the path without exposing its parts', () => {
  expect(webVitalRoute('/')).toBe('landing')
  expect(webVitalRoute('/login')).toBe('login')
  expect(webVitalRoute('/articles')).toBe('articles')
  expect(webVitalRoute('/q3a2080e99bcf4027a2c/the-harbour-before-dawn')).toBe(
    'article'
  )
  expect(webVitalRoute('/dashboard/stats')).toBe('other')
  expect(webVitalRoute('/q3a2080e99bcf4027a2c')).toBe('other')
})

test('measurements become a rating and a band, never the number', () => {
  expect(
    webVitalProperties(
      { name: 'LCP', value: 1873.4, rating: 'good' },
      '/articles',
      412
    )
  ).toEqual({
    metric: 'LCP',
    rating: 'good',
    band: '1500-1999',
    route: 'articles',
    device: 'mobile',
  })
  expect(
    webVitalProperties(
      { name: 'CLS', value: 0.12, rating: 'needs-improvement' },
      '/',
      1440
    )
  ).toMatchObject({ band: '0.1-0.249', device: 'desktop' })
  expect(
    webVitalProperties({ name: 'INP', value: 520, rating: 'poor' }, '/', 390)
  ).toMatchObject({ band: '>=500' })
  expect(
    webVitalProperties(
      { name: 'LCP', value: 2000, rating: 'needs-improvement' },
      '/',
      390
    )
  ).toMatchObject({ band: '2000-2499' })
})

test('unknown measures, ratings and values are not reported', () => {
  expect(
    webVitalProperties({ name: 'FID', value: 10, rating: 'good' }, '/', 400)
  ).toBeNull()
  expect(
    webVitalProperties({ name: 'LCP', value: 10, rating: 'great' }, '/', 400)
  ).toBeNull()
  expect(
    webVitalProperties(
      { name: 'LCP', value: Number.NaN, rating: 'good' },
      '/',
      400
    )
  ).toBeNull()
})

test('the relay forwards web_vital with fixed values only', async () => {
  vi.stubEnv('NEXT_PUBLIC_ANALYTICS_ENABLED', 'true')
  vi.stubEnv('ANALYTICS_POSTHOG_KEY', 'phc_test')
  vi.resetModules()
  const { POST } = await import('../../app/api/analytics/route')
  const response = await POST(
    new Request('https://quilltip.test/api/analytics', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'sec-fetch-site': 'same-origin',
      },
      body: JSON.stringify({
        event: 'web_vital',
        distinctId: ID,
        path: '/articles',
        properties: {
          metric: 'LCP',
          rating: 'good',
          band: '1500-1999',
          route: 'articles',
          device: 'mobile',
          value: 1873.4,
          element: 'img.cover',
        },
      }),
    })
  )
  expect(response.status).toBe(204)
  const call = upstream.mock.calls[0] as unknown as [string, RequestInit]
  const body = JSON.parse(String(call[1].body))
  expect(body.event).toBe('web_vital')
  expect(body.properties).toMatchObject({
    metric: 'LCP',
    rating: 'good',
    band: '1500-1999',
    route: 'articles',
    device: 'mobile',
  })
  expect(body.properties.value).toBeUndefined()
  expect(body.properties.element).toBeUndefined()
  expect(WEB_VITAL_BANDS).toContain('1500-1999')
})
