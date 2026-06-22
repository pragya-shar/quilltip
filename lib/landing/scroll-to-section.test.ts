import { describe, it, expect } from 'vitest'
import { LANDING_NAV_HASHES, LANDING_SECTION_IDS } from './nav-targets'

describe('landing nav targets', () => {
  it('maps every nav hash to a known section id', () => {
    for (const hash of LANDING_NAV_HASHES) {
      const id = hash.slice(1)
      expect(LANDING_SECTION_IDS).toContain(id)
    }
  })

  it('includes security anchor', () => {
    expect(LANDING_SECTION_IDS).toContain('security')
  })
})
