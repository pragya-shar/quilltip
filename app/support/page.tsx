import type { Metadata } from 'next'
import Link from 'next/link'
import { InfoPageLayout } from '@/components/layout/InfoPageLayout'
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
    <InfoPageLayout title="Help & Support" description={supportIntro}>
      <div className="space-y-10 text-foreground">
        {supportSections.map((section) => (
          <section key={section.id} id={section.id}>
            <h2 className="text-lg font-semibold text-foreground mb-3">
              {section.title}
            </h2>
            <div className="space-y-3 text-sm leading-relaxed text-muted-foreground">
              {section.paragraphs.map((paragraph, index) => (
                <p key={`${section.id}-${index}`}>{paragraph}</p>
              ))}
            </div>
          </section>
        ))}

        <section>
          <h2 className="text-lg font-semibold text-foreground mb-3">
            Quick links
          </h2>
          <ul className="space-y-2 text-sm">
            {supportResourceLinks.map((link) => (
              <li key={link.href}>
                <Link
                  href={link.href}
                  className="text-primary hover:underline underline-offset-4"
                >
                  {link.label}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </InfoPageLayout>
  )
}
