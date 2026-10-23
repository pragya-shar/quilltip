export type SiteNavigationLink = { href: string; label: string }

export const PRIMARY_NAVIGATION_LINKS: SiteNavigationLink[] = [
  { href: '/articles', label: 'Articles' },
  { href: '/library', label: 'Your library' },
  { href: '/write', label: 'Writing desk' },
]

export function getAccountNavigationLinks(
  username?: string | null
): SiteNavigationLink[] {
  return [
    { href: '/drafts', label: 'Drafts' },
    { href: username ? `/${username}` : '/profile', label: 'Public profile' },
    { href: '/dashboard/wallet', label: 'Wallet' },
    { href: '/dashboard/stats', label: 'Stats' },
  ]
}
