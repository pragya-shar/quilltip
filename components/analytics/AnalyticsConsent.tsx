'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  CONSENT_EVENT,
  readConsent,
  writeConsent,
  type AnalyticsConsent as Consent,
} from '@/lib/analytics/consent'
import { track } from '@/lib/analytics/track'
import './analytics.css'

/**
 * Asks once whether optional product analytics may run, then records page
 * views only after a visitor allows it. Rendered only when analytics is
 * enabled for the deployment.
 */
export function AnalyticsConsent() {
  const pathname = usePathname()
  const [consent, setConsent] = useState<Consent | null | undefined>(undefined)
  const lastPath = useRef<string | null>(null)

  useEffect(() => {
    setConsent(readConsent())
    const onChange = () => setConsent(readConsent())
    window.addEventListener(CONSENT_EVENT, onChange)
    return () => window.removeEventListener(CONSENT_EVENT, onChange)
  }, [])

  useEffect(() => {
    if (consent !== 'granted' || lastPath.current === pathname) return
    lastPath.current = pathname
    track('$pageview')
  }, [consent, pathname])

  if (consent !== null) return null

  return (
    <section
      className="analytics-consent"
      aria-labelledby="analytics-consent-title"
    >
      <h2 id="analytics-consent-title">Help us improve QuillTip?</h2>
      <p>
        With your OK, we count page views and a few actions to see what works.
        No ads, no selling data, and nothing you write is included.{' '}
        <Link href="/privacy#analytics">How it works</Link>
      </p>
      <div className="analytics-consent-actions">
        <button type="button" onClick={() => writeConsent('granted')}>
          Allow
        </button>
        <button type="button" onClick={() => writeConsent('denied')}>
          No thanks
        </button>
      </div>
    </section>
  )
}
