import Link from 'next/link'
import {
  FOOTER_LINK_CATEGORIES,
  FOOTER_LINK_GROUP_LABELS,
  FOOTER_LINKS,
} from '@/lib/copy/footer-links'

export function FooterNav() {
  return (
    <nav aria-label="Footer" className="app-footer-nav">
      {FOOTER_LINK_CATEGORIES.map((category) => (
        <div key={category}>
          <h2>{FOOTER_LINK_GROUP_LABELS[category]}</h2>
          <ul>
            {FOOTER_LINKS.filter((link) => link.category === category).map(
              ({ href, label }) => (
                <li key={href}>
                  <Link href={href}>{label}</Link>
                </li>
              )
            )}
          </ul>
        </div>
      ))}
    </nav>
  )
}
