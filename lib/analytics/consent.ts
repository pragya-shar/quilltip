// Consent for optional product analytics, stored only in this browser.
// Nothing is recorded, and no identifier exists, until a visitor allows it.

export type AnalyticsConsent = 'granted' | 'denied'

const CONSENT_KEY = 'quilltip.analytics-consent'
const ID_KEY = 'quilltip.analytics-id'
export const CONSENT_EVENT = 'quilltip:analytics-consent'

/** Do Not Track or Global Privacy Control count as a refusal. */
export function browserOptsOut(): boolean {
  if (typeof navigator === 'undefined') return false
  const nav = navigator as Navigator & { globalPrivacyControl?: boolean }
  return nav.doNotTrack === '1' || nav.globalPrivacyControl === true
}

export function readConsent(): AnalyticsConsent | null {
  if (browserOptsOut()) return 'denied'
  try {
    const value = window.localStorage.getItem(CONSENT_KEY)
    return value === 'granted' || value === 'denied' ? value : null
  } catch {
    return null
  }
}

export function writeConsent(value: AnalyticsConsent) {
  try {
    window.localStorage.setItem(CONSENT_KEY, value)
    if (value === 'denied') window.localStorage.removeItem(ID_KEY)
  } catch {
    // Storage blocked: the choice lasts for this page only.
  }
  window.dispatchEvent(new CustomEvent(CONSENT_EVENT, { detail: value }))
}

/** Random, per-browser id created only after consent. */
export function analyticsId(): string | null {
  if (readConsent() !== 'granted') return null
  try {
    let id = window.localStorage.getItem(ID_KEY)
    if (!id) {
      id = crypto.randomUUID()
      window.localStorage.setItem(ID_KEY, id)
    }
    return id
  } catch {
    return null
  }
}
