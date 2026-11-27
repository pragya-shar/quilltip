import type { Metadata } from 'next'
import { LegalPageLayout } from '@/components/legal/LegalPageLayout'
import { privacyLastUpdated, privacySections } from '@/lib/copy/legal-privacy'
import { AnalyticsPreferences } from '@/components/analytics/AnalyticsPreferences'
import { analyticsServerKey } from '@/lib/analytics/config'

export const metadata: Metadata = {
  title: 'Privacy Policy | Quilltip',
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
            recording anything. If you allow it, we count page views and a few
            actions, such as joining the waitlist or sending feedback. We also
            record how quickly each page loads and whether it shifts while
            loading, as a rating and a range for each measure, to check the
            site’s speed. A page view records the page path without search terms
            or other query details, so a visit to a public article records that
            article’s link. Events go through Quilltip’s own server to PostHog,
            hosted in the EU, so your IP address is not shared with them. We
            never include what you write, your name, your email address or your
            wallet address. Do Not Track and Global Privacy Control are treated
            as a refusal.
          </p>
          <AnalyticsPreferences enabled={analyticsServerKey() !== null} />
        </div>
      </section>
    </LegalPageLayout>
  )
}
