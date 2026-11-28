// Page-speed measurements from real visits, sent as the `web_vital` analytics
// event only after a visitor allows analytics (components/analytics). Each
// event carries fixed values: which measure, its rating, a value band, the
// kind of page and the device class. The measured number itself, the page's
// query string and anything a visitor wrote are never sent.

import { APP_ROUTE_SEGMENTS } from '../routing/publicContentPath'
export const WEB_VITAL_METRICS = ['LCP', 'CLS', 'INP', 'FCP', 'TTFB'] as const
export type WebVitalMetric = (typeof WEB_VITAL_METRICS)[number]

export const WEB_VITAL_RATINGS = ['good', 'needs-improvement', 'poor'] as const

/** Kinds of page; the page path itself is already part of every event. */
export const WEB_VITAL_ROUTES = [
  'landing',
  'login',
  'articles',
  'article',
  'other',
] as const

export const WEB_VITAL_DEVICES = ['mobile', 'desktop'] as const

// Millisecond bands for the timing measures, unitless bands for CLS. The 2 s
// edge matches the page-load target (docs/performance/page-load.md).
const MS_BANDS = [
  [1000, '<1000'],
  [1500, '1000-1499'],
  [2000, '1500-1999'],
  [2500, '2000-2499'],
  [4000, '2500-3999'],
  [Infinity, '>=4000'],
] as const
const INP_BANDS = [
  [200, '<200'],
  [500, '200-499'],
  [Infinity, '>=500'],
] as const
const CLS_BANDS = [
  [0.05, '<0.05'],
  [0.1, '0.05-0.099'],
  [0.25, '0.1-0.249'],
  [Infinity, '>=0.25'],
] as const

export const WEB_VITAL_BANDS = [
  ...new Set([...MS_BANDS, ...INP_BANDS, ...CLS_BANDS].map(([, band]) => band)),
] as readonly string[]

function band(
  value: number,
  bands: readonly (readonly [number, string])[]
): string {
  return bands.find(([limit]) => value < limit)![1]
}

/** The kind of page for a path, without exposing the path's parts. */
export function webVitalRoute(
  pathname: string
): (typeof WEB_VITAL_ROUTES)[number] {
  if (pathname === '/') return 'landing'
  if (pathname === '/login') return 'login'
  if (pathname === '/articles') return 'articles'
  // Public article pages are /<writer>/<slug> with no fixed first segment.
  const parts = pathname.split('/').filter(Boolean)
  if (parts.length === 2 && !RESERVED_FIRST_SEGMENTS.has(parts[0]!))
    return 'article'
  return 'other'
}

// A first segment that is an app route (every top-level route, from the
// one list the proxy and the handle rules use) is never a writer.
const RESERVED_FIRST_SEGMENTS: ReadonlySet<string> = new Set([
  ...APP_ROUTE_SEGMENTS,
  'api',
])

export type ReportedMetric = {
  name: string
  value: number
  rating: string
}

/**
 * The event properties for one measurement, or null for a measure that is
 * not reported.
 */
export function webVitalProperties(
  metric: ReportedMetric,
  pathname: string,
  viewportWidth: number
): Record<string, string> | null {
  if (!(WEB_VITAL_METRICS as readonly string[]).includes(metric.name))
    return null
  if (!(WEB_VITAL_RATINGS as readonly string[]).includes(metric.rating))
    return null
  if (!Number.isFinite(metric.value) || metric.value < 0) return null
  const bands =
    metric.name === 'CLS'
      ? CLS_BANDS
      : metric.name === 'INP'
        ? INP_BANDS
        : MS_BANDS
  return {
    metric: metric.name,
    rating: metric.rating,
    band: band(metric.value, bands),
    route: webVitalRoute(pathname),
    device: viewportWidth < 768 ? 'mobile' : 'desktop',
  }
}
