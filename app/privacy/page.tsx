import type { Metadata } from 'next'
import { LegalPageLayout } from '@/components/legal/LegalPageLayout'
import { privacyLastUpdated, privacySections } from '@/lib/copy/legal-privacy'

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
    />
  )
}
