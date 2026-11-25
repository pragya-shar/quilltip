'use client'

import { useEffect, useState } from 'react'
import {
  CONSENT_EVENT,
  browserOptsOut,
  readConsent,
  writeConsent,
  type AnalyticsConsent,
} from '@/lib/analytics/consent'

/** Lets a visitor change their analytics choice from the privacy page. */
export function AnalyticsPreferences({ enabled }: { enabled: boolean }) {
  const [consent, setConsent] = useState<AnalyticsConsent | null>(null)
  const [optedOut, setOptedOut] = useState(false)

  useEffect(() => {
    setConsent(readConsent())
    setOptedOut(browserOptsOut())
    const onChange = () => setConsent(readConsent())
    window.addEventListener(CONSENT_EVENT, onChange)
    return () => window.removeEventListener(CONSENT_EVENT, onChange)
  }, [])

  if (!enabled) {
    return <p>Product analytics is turned off on this site.</p>
  }
  if (optedOut) {
    return (
      <p>
        Your browser asks sites not to track you, so product analytics stays
        off.
      </p>
    )
  }
  return (
    <div className="legal-analytics">
      <p role="status">
        {consent === 'granted'
          ? 'Product analytics is on for this browser.'
          : consent === 'denied'
            ? 'Product analytics is off for this browser.'
            : 'You haven’t chosen yet. Product analytics is off until you allow it.'}
      </p>
      <div className="legal-analytics-actions">
        <button
          type="button"
          aria-pressed={consent === 'granted'}
          onClick={() => writeConsent('granted')}
        >
          Allow analytics
        </button>
        <button
          type="button"
          aria-pressed={consent === 'denied'}
          onClick={() => writeConsent('denied')}
        >
          Turn analytics off
        </button>
      </div>
    </div>
  )
}
