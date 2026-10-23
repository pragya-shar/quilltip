export type FooterLinkCategory = 'legal' | 'support' | 'contact'

export type FooterLink = {
  label: string
  href: string
  category: FooterLinkCategory
}

export const FOOTER_LINKS: FooterLink[] = [
  { label: 'Terms of Service', href: '/terms', category: 'legal' },
  { label: 'Privacy Policy', href: '/privacy', category: 'legal' },
  { label: 'Help & Support', href: '/support', category: 'support' },
  {
    label: 'Wallet & Stellar demo',
    href: '/wallet/practice',
    category: 'support',
  },
  { label: 'Contact', href: '/contact', category: 'contact' },
]

export const FOOTER_LINK_GROUP_LABELS: Record<FooterLinkCategory, string> = {
  legal: 'Policies',
  support: 'Help & information',
  contact: 'Get in touch',
}

export const FOOTER_LINK_CATEGORIES: FooterLinkCategory[] = [
  'support',
  'legal',
  'contact',
]

export const AUTH_FOOTER_LINKS = FOOTER_LINKS.filter(
  (link) => link.category !== 'legal'
)

export const INTERNAL_FOOTER_ROUTES = [
  '/terms',
  '/privacy',
  '/wallet/practice',
  '/support',
  '/contact',
] as const
