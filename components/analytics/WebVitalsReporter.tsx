'use client'

import { useReportWebVitals } from 'next/web-vitals'
import { track } from '@/lib/analytics/track'
import { webVitalProperties } from '@/lib/analytics/webVitals'

/**
 * Sends page-speed measurements (LCP, CLS, INP, FCP, TTFB) from this visit as
 * `web_vital` events. AnalyticsConsent renders it only after the visitor has
 * allowed analytics, and loads it on demand, so it is not part of any page's
 * first load. Measurements recorded before it loads are still reported.
 */
export function WebVitalsReporter() {
  useReportWebVitals((metric) => {
    const properties = webVitalProperties(
      metric,
      window.location.pathname,
      window.innerWidth
    )
    if (properties) track('web_vital', properties)
  })
  return null
}
