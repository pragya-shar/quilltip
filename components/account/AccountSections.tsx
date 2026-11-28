import Link from 'next/link'
import { SETTINGS_PATH } from '@/lib/navigation/siteNavigation'

/**
 * The old dashboard's section row. Balance and earnings moved to the
 * balance sheet (/pocket), which is not a tab of this row: a link out of
 * here into the application shell is a full page load.
 */
export const ACCOUNT_SECTIONS = [
  { href: '/dashboard/wallet', label: 'Wallet' },
  { href: '/dashboard/tab', label: 'Tab' },
  { href: '/dashboard/stats', label: 'Stats' },
  { href: '/dashboard/feedback', label: 'Feedback' },
  { href: SETTINGS_PATH, label: 'Settings' },
] as const

export function AccountSections({
  pathname,
  username,
}: {
  pathname: string | null
  username?: string | null
}) {
  return (
    <nav className="account-nav" aria-label="Account sections">
      {ACCOUNT_SECTIONS.map(({ href, label }) => (
        <Link
          key={href}
          href={href}
          aria-current={pathname === href ? 'page' : undefined}
        >
          {label}
        </Link>
      ))}
      {username ? <span className="account-name">@{username}</span> : null}
    </nav>
  )
}
