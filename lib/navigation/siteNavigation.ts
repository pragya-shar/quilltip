export type SiteNavigationLink = { href: string; label: string }

export const PRIMARY_NAVIGATION_LINKS: SiteNavigationLink[] = [
  { href: '/articles', label: 'Articles' },
  { href: '/library', label: 'Your library' },
  { href: '/write', label: 'Writing desk' },
]

export const SETTINGS_PATH = '/settings'
export const WELCOME_PATH = '/welcome'
export const SUPPORT_PATH = '/support'

/** The account menu, in order. Sign out follows these links. */
export function getAccountNavigationLinks(
  username?: string | null
): SiteNavigationLink[] {
  return [
    {
      href: username ? `/${encodeURIComponent(username)}` : SETTINGS_PATH,
      label: 'View profile',
    },
    { href: SETTINGS_PATH, label: 'Settings' },
    { href: '/drafts', label: 'Drafts' },
    // The balance sheet, in the application shell (a page change).
    { href: '/pocket', label: 'Balance' },
    { href: '/dashboard/stats', label: 'Stats' },
    { href: '/dashboard/wallet', label: 'Wallet' },
    { href: SUPPORT_PATH, label: 'Help & support' },
  ]
}
