import { describe, it, expect } from 'vitest'
import {
  AUTH_FOOTER_LINKS,
  FOOTER_LINKS,
  FOOTER_LINK_CATEGORIES,
  FOOTER_LINK_GROUP_LABELS,
  INTERNAL_FOOTER_ROUTES,
} from '@/lib/copy/footer-links'

describe('footer-links', () => {
  it('includes legal, support, contact, and status categories', () => {
    expect(FOOTER_LINK_CATEGORIES).toEqual([
      'legal',
      'support',
      'contact',
      'status',
    ])

    for (const category of FOOTER_LINK_CATEGORIES) {
      expect(FOOTER_LINK_GROUP_LABELS[category]).toBeTruthy()
      expect(FOOTER_LINKS.some((link) => link.category === category)).toBe(true)
    }
  })

  it('uses only known internal routes for footer destinations', () => {
    for (const link of FOOTER_LINKS) {
      expect(link.href.startsWith('/')).toBe(true)
      expect(INTERNAL_FOOTER_ROUTES).toContain(
        link.href as (typeof INTERNAL_FOOTER_ROUTES)[number]
      )
    }
  })

  it('excludes legal links from auth footer compact row', () => {
    expect(AUTH_FOOTER_LINKS.every((link) => link.category !== 'legal')).toBe(
      true
    )
    expect(AUTH_FOOTER_LINKS.map((link) => link.label)).toEqual([
      'Help & Support',
      'Wallet Guide',
      'Contact',
      'Platform Status',
    ])
  })
})
