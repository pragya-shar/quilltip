import type { Metadata } from 'next'
import { LegalPageLayout } from '@/components/legal/LegalPageLayout'
import { termsLastUpdated, termsSections } from '@/lib/copy/legal-terms'

export const metadata: Metadata = {
  title: 'Terms of Service | Quilltip',
  description:
    'Terms of Service for Quilltip, the decentralized publishing platform for writers and readers on Stellar testnet.',
}

export default function TermsPage() {
  return (
    <LegalPageLayout
      title="Terms of Service"
      lastUpdated={termsLastUpdated}
      sections={termsSections}
      alternatePolicy={{
        href: '/privacy',
        label: 'Privacy Policy',
      }}
    />
  )
}
