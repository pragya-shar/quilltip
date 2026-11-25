import { ANALYTICS_ENABLED, type AnalyticsEvent } from './config'
import { analyticsId } from './consent'

// Set by the consent prompt, which renders only when the deployment has both
// the public flag and the server key. Until then nothing is sent.
let active = false
export function activateAnalytics() {
  active = true
}

/**
 * Records one product event when analytics is enabled and the visitor has
 * allowed it. Sends only the event name, the page path without its query
 * string, and the given properties. Never throws.
 */
export function track(
  event: AnalyticsEvent,
  properties: Record<string, string | number | boolean> = {}
) {
  if (!ANALYTICS_ENABLED || !active || typeof window === 'undefined') return
  const distinctId = analyticsId()
  if (!distinctId) return
  const body = JSON.stringify({
    event,
    distinctId,
    path: window.location.pathname,
    properties,
  })
  try {
    if (navigator.sendBeacon?.('/api/analytics', body)) return
    void fetch('/api/analytics', {
      method: 'POST',
      body,
      keepalive: true,
      headers: { 'content-type': 'application/json' },
    }).catch(() => undefined)
  } catch {
    // Analytics must never break the page.
  }
}
