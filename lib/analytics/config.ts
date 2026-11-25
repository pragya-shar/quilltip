// Product analytics is off unless NEXT_PUBLIC_ANALYTICS_ENABLED is "true".
// The provider (PostHog) also needs ANALYTICS_POSTHOG_KEY on the server; see
// docs/SETUP.md. Events go through /api/analytics on this site, so visitor IP
// addresses never reach the provider and no third-party script is loaded.
export const ANALYTICS_ENABLED =
  process.env.NEXT_PUBLIC_ANALYTICS_ENABLED === 'true'

export const ANALYTICS_EVENTS = [
  '$pageview',
  'waitlist_joined',
  'feedback_sent',
] as const

export type AnalyticsEvent = (typeof ANALYTICS_EVENTS)[number]

export function isAnalyticsEvent(value: unknown): value is AnalyticsEvent {
  return (
    typeof value === 'string' &&
    (ANALYTICS_EVENTS as readonly string[]).includes(value)
  )
}
