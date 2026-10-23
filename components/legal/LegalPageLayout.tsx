import Link from 'next/link'
import { SiteHeader } from '@/components/layout/SiteHeader'
import { Button } from '@/components/ui/button'
import { SiteFooter } from '@/components/layout/SiteFooter'
import type { LegalSection } from '@/lib/copy/legal-shared'
import './legal.css'

type LegalPageLayoutProps = {
  title: string
  lastUpdated: string
  sections: LegalSection[]
  alternatePolicy: {
    href: '/terms' | '/privacy'
    label: string
  }
}

export function LegalPageLayout({
  title,
  lastUpdated,
  sections,
  alternatePolicy,
}: LegalPageLayoutProps) {
  return (
    <div className="legal-page">
      <SiteHeader />
      <main className="legal-main">
        <article aria-labelledby="policy-title">
          <header className="legal-header">
            <p className="legal-date">Last updated: {lastUpdated}</p>
            <h1 id="policy-title">{title}</h1>
          </header>

          <div className="legal-sections">
            {sections.map((section) => (
              <section
                key={section.id}
                id={section.id}
                aria-labelledby={`${section.id}-title`}
              >
                <h2 id={`${section.id}-title`}>{section.title}</h2>
                <div className="legal-paragraphs">
                  {section.paragraphs.map((paragraph, index) => (
                    <p key={`${section.id}-${index}`}>{paragraph}</p>
                  ))}
                </div>
              </section>
            ))}
          </div>

          <footer className="legal-footer">
            <p className="legal-related">
              See also:{' '}
              <Link href={alternatePolicy.href} className="legal-policy-link">
                {alternatePolicy.label}
              </Link>
            </p>

            <nav className="legal-actions" aria-label="Continue exploring">
              <Button asChild className="min-h-11 h-auto whitespace-normal">
                <Link href="/">Back to home</Link>
              </Button>
              <Button
                asChild
                variant="outline"
                className="min-h-11 h-auto whitespace-normal"
              >
                <Link href="/articles">Browse articles</Link>
              </Button>
            </nav>
          </footer>
        </article>
      </main>
      <SiteFooter variant="default" />
    </div>
  )
}
