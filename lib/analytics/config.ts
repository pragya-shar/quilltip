// Product analytics is off unless NEXT_PUBLIC_ANALYTICS_ENABLED is "true".
// The provider (PostHog) also needs ANALYTICS_POSTHOG_KEY on the server; see
// docs/SETUP.md. Events go through /api/analytics on this site, so visitor IP
// addresses never reach the provider and no third-party script is loaded.
export const ANALYTICS_ENABLED =
  process.env.NEXT_PUBLIC_ANALYTICS_ENABLED === 'true'

/**
 * Server only: the provider key when analytics is enabled and configured,
 * otherwise null. The consent prompt, the privacy controls and the relay all
 * stay off without it.
 */
export function analyticsServerKey(): string | null {
  if (process.env.NEXT_PUBLIC_ANALYTICS_ENABLED !== 'true') return null
  return process.env.ANALYTICS_POSTHOG_KEY || null
}

import {
  WEB_VITAL_BANDS,
  WEB_VITAL_DEVICES,
  WEB_VITAL_METRICS,
  WEB_VITAL_RATINGS,
  WEB_VITAL_ROUTES,
} from './webVitals'

export const ANALYTICS_EVENTS = [
  '$pageview',
  'waitlist_joined',
  'feedback_sent',
  'web_vital',
] as const

export type AnalyticsEvent = (typeof ANALYTICS_EVENTS)[number]

export function isAnalyticsEvent(value: unknown): value is AnalyticsEvent {
  return (
    typeof value === 'string' &&
    (ANALYTICS_EVENTS as readonly string[]).includes(value)
  )
}

// The only properties each event may carry, with their allowed values.
// Anything else is dropped, so free text never reaches the provider.
const EVENT_PROPERTIES: Record<
  AnalyticsEvent,
  Record<string, readonly string[]>
> = {
  $pageview: {},
  waitlist_joined: {},
  feedback_sent: { category: ['bug', 'idea', 'question', 'other'] },
  // Page speed from real visits (lib/analytics/webVitals.ts): fixed values
  // only, never the measured number itself.
  web_vital: {
    metric: WEB_VITAL_METRICS,
    rating: WEB_VITAL_RATINGS,
    band: WEB_VITAL_BANDS,
    route: WEB_VITAL_ROUTES,
    device: WEB_VITAL_DEVICES,
  },
}

export function cleanEventProperties(
  event: AnalyticsEvent,
  value: unknown
): Record<string, string> {
  const result: Record<string, string> = {}
  if (!value || typeof value !== 'object') return result
  const allowed = EVENT_PROPERTIES[event]
  for (const [key, values] of Object.entries(allowed)) {
    const raw = (value as Record<string, unknown>)[key]
    if (typeof raw === 'string' && values.includes(raw)) result[key] = raw
  }
  return result
}
