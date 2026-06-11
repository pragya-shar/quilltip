'use client'

import Link from 'next/link'
import { SiteHeader } from '@/components/layout/SiteHeader'
import { Button } from '@/components/ui/button'
import { SiteFooter } from '@/components/layout/SiteFooter'
import type { LegalSection } from '@/lib/copy/legal-shared'

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
    <div className="flex min-h-screen flex-col bg-background">
      <SiteHeader />
      <div className="flex-1 pt-24 pb-16 px-4">
        <article className="mx-auto max-w-3xl">
          <header className="mb-10 border-b border-border pb-8">
            <p className="text-sm text-muted-foreground mb-2">
              Last updated: {lastUpdated}
            </p>
            <h1 className="font-display text-3xl lg:text-4xl font-medium tracking-[-0.01em] text-foreground">
              {title}
            </h1>
          </header>

          <div className="space-y-10 text-foreground">
            {sections.map((section) => (
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
          </div>

          <footer className="mt-12 pt-8 border-t border-border space-y-6">
            <p className="text-sm text-muted-foreground">
              See also:{' '}
              <Link
                href={alternatePolicy.href}
                className="text-primary hover:underline underline-offset-4"
              >
                {alternatePolicy.label}
              </Link>
            </p>

            <div className="flex flex-col sm:flex-row gap-3 sm:items-center">
              <Button asChild className="sm:w-auto w-full">
                <Link href="/">Back to home</Link>
              </Button>
              <Button asChild variant="outline" className="sm:w-auto w-full">
                <Link href="/articles">Browse articles</Link>
              </Button>
            </div>
          </footer>
        </article>
      </div>
      <SiteFooter variant="default" />
    </div>
  )
}
