import type { Metadata } from 'next'
import { LegalPageLayout } from '@/components/legal/LegalPageLayout'
import { privacyLastUpdated, privacySections } from '@/lib/copy/legal-privacy'
import { AnalyticsPreferences } from '@/components/analytics/AnalyticsPreferences'
import { analyticsServerKey } from '@/lib/analytics/config'

export const metadata: Metadata = {
  title: 'Privacy Policy | QuillTip',
  description:
    'Privacy Policy for Quilltip, describing how we collect, use, and protect your information.',
}

export default function PrivacyPage() {
  return (
    <LegalPageLayout
      title="Privacy Policy"
      lastUpdated={privacyLastUpdated}
      sections={privacySections}
      alternatePolicy={{
        href: '/terms',
        label: 'Terms of Service',
      }}
    >
      <section id="analytics" aria-labelledby="analytics-title">
        <h2 id="analytics-title">Optional product analytics</h2>
        <div className="legal-paragraphs">
          <p>
            When product analytics is turned on for this site, we ask before
            recording anything. If you allow it, we count page views (the page
            path, without search terms or other query details) and a few
            actions, such as joining the waitlist or sending feedback. Events go
            through QuillTip’s own server to PostHog, hosted in the EU, so your
            IP address is not shared with them. We never include what you write
            or read. Do Not Track and Global Privacy Control are treated as a
            refusal.
          </p>
          <AnalyticsPreferences enabled={analyticsServerKey() !== null} />
        </div>
      </section>
    </LegalPageLayout>
  )
}
