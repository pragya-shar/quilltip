import Link from 'next/link'
import { cn } from '@/lib/utils'
import {
  FOOTER_LINK_CATEGORIES,
  FOOTER_LINK_GROUP_LABELS,
  FOOTER_LINKS,
  type FooterLinkCategory,
} from '@/lib/copy/footer-links'

type FooterNavProps = {
  className?: string
  linkClassName?: string
  groupLabelClassName?: string
  variant?: 'landing' | 'default'
}

function linksForCategory(category: FooterLinkCategory) {
  return FOOTER_LINKS.filter((link) => link.category === category)
}

export function FooterNav({
  className,
  linkClassName,
  groupLabelClassName,
  variant = 'default',
}: FooterNavProps) {
  const defaultLinkStyles =
    variant === 'landing'
      ? 'text-spotlight-muted hover:text-spotlight-foreground text-[13px]'
      : 'text-muted-foreground hover:text-foreground text-sm'

  const defaultGroupLabelStyles =
    variant === 'landing'
      ? 'text-spotlight-foreground text-xs font-semibold uppercase tracking-wide'
      : 'text-foreground text-xs font-semibold uppercase tracking-wide'

  const linkStyles = cn(
    'hover:underline underline-offset-4 transition-colors',
    linkClassName ?? defaultLinkStyles
  )

  const groupLabelStyles = cn(
    'mb-2 block',
    groupLabelClassName ?? defaultGroupLabelStyles
  )

  return (
    <nav
      aria-label="Footer"
      className={cn(
        'grid grid-cols-2 gap-6 sm:grid-cols-4 sm:gap-8',
        className
      )}
    >
      {FOOTER_LINK_CATEGORIES.map((category) => (
        <div key={category}>
          <span className={groupLabelStyles}>
            {FOOTER_LINK_GROUP_LABELS[category]}
          </span>
          <ul className="space-y-2">
            {linksForCategory(category).map((link) => (
              <li key={link.href}>
                <Link href={link.href} className={linkStyles}>
                  {link.label}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </nav>
  )
}
