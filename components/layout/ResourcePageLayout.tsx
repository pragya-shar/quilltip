import Link from 'next/link'
import type { ReactNode } from 'react'
import { SiteHeader } from './SiteHeader'
import { SiteFooter } from './SiteFooter'
import './resource-page.css'

type ResourcePageLayoutProps = {
  title: string
  description: string
  navigationTitle: string
  links: { label: string; href: string }[]
  children: ReactNode
}

export function ResourcePageLayout({
  title,
  description,
  navigationTitle,
  links,
  children,
}: ResourcePageLayoutProps) {
  return (
    <div className="resource-page">
      <SiteHeader />
      <main className="resource-folio" id="main-content">
        <header className="resource-heading">
          <h1>{title}</h1>
          <p>{description}</p>
        </header>
        <div className="resource-columns">
          <nav className="resource-navigation" aria-label={navigationTitle}>
            <h2>{navigationTitle}</h2>
            <ul>
              {links.map((link) => (
                <li key={link.href}>
                  <Link href={link.href}>{link.label}</Link>
                </li>
              ))}
            </ul>
          </nav>
          <div className="resource-content">{children}</div>
        </div>
      </main>
      <SiteFooter />
    </div>
  )
}
