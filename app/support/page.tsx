import type { Metadata } from 'next'
import Link from 'next/link'
import { ResourcePageLayout } from '@/components/layout/ResourcePageLayout'
import {
  supportIntro,
  supportResourceLinks,
  supportSections,
} from '@/lib/copy/support-page'

export const metadata: Metadata = {
  title: 'Help & Support | Quilltip',
  description:
    'Get help using Quilltip on Stellar testnet. Wallet setup, practice tipping, and support channels.',
}

export default function SupportPage() {
  return (
    <ResourcePageLayout
      title="Help & Support"
      description={supportIntro}
      navigationTitle="Quick links"
      links={supportResourceLinks}
    >
      {supportSections.map((section) => (
        <section key={section.id} id={section.id}>
          <h2>{section.title}</h2>
          {section.paragraphs.map((paragraph, index) => (
            <p key={`${section.id}-${index}`}>{paragraph}</p>
          ))}
          {section.link ? (
            <Link className="resource-action" href={section.link.href}>
              {section.link.label}
            </Link>
          ) : null}
        </section>
      ))}
    </ResourcePageLayout>
  )
}
