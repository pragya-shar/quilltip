import { describe, expect, it } from 'vitest'
import {
  DASHBOARD_HOME_BROWSE_CARD,
  DASHBOARD_HOME_EARNINGS_CARD,
} from '@/lib/copy/dashboard-home'

describe('dashboard-home copy', () => {
  it('uses reader vocabulary on browse card', () => {
    expect(DASHBOARD_HOME_BROWSE_CARD.description).toMatch(/move you/)
  })

  it('softens earnings card without testnet mention', () => {
    expect(DASHBOARD_HOME_EARNINGS_CARD.description).toBe(
      'Track tips and article performance'
    )
    expect(DASHBOARD_HOME_EARNINGS_CARD.description).not.toMatch(/testnet/i)
  })
})
