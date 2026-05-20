export type FooterLinkCategory = 'legal' | 'support' | 'contact' | 'status'

export type FooterLink = {
  label: string
  href: string
  category: FooterLinkCategory
}

export const FOOTER_LINKS: FooterLink[] = [
  { label: 'Terms of Service', href: '/terms', category: 'legal' },
  { label: 'Privacy Policy', href: '/privacy', category: 'legal' },
  { label: 'Help & Support', href: '/support', category: 'support' },
  { label: 'Wallet Guide', href: '/guide', category: 'support' },
  { label: 'Contact', href: '/contact', category: 'contact' },
  { label: 'Platform Status', href: '/status', category: 'status' },
]

export const FOOTER_LINK_GROUP_LABELS: Record<FooterLinkCategory, string> = {
  legal: 'Legal',
  support: 'Support',
  contact: 'Contact',
  status: 'Status',
}

export const FOOTER_LINK_CATEGORIES: FooterLinkCategory[] = [
  'legal',
  'support',
  'contact',
  'status',
]

export const AUTH_FOOTER_LINKS = FOOTER_LINKS.filter(
  (link) => link.category !== 'legal'
)

export const INTERNAL_FOOTER_ROUTES = [
  '/terms',
  '/privacy',
  '/guide',
  '/support',
  '/contact',
  '/status',
] as const
