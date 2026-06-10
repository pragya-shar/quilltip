import { describe, expect, it } from 'vitest'
import {
  DEFAULT_DASHBOARD_TAB,
  getDashboardTabPath,
  isDashboardTabId,
  parseLegacyProfileCreatorTab,
} from './dashboardTab'

describe('getDashboardTabPath', () => {
  it('builds dashboard sub-routes', () => {
    expect(getDashboardTabPath('wallet')).toBe('/dashboard/wallet')
    expect(getDashboardTabPath('earnings')).toBe('/dashboard/earnings')
    expect(getDashboardTabPath('stats')).toBe('/dashboard/stats')
  })
})

describe('isDashboardTabId', () => {
  it('accepts dashboard tab ids', () => {
    expect(isDashboardTabId('wallet')).toBe(true)
    expect(isDashboardTabId('earnings')).toBe(true)
    expect(isDashboardTabId('stats')).toBe(true)
    expect(isDashboardTabId('articles')).toBe(false)
    expect(isDashboardTabId(null)).toBe(false)
  })
})

describe('parseLegacyProfileCreatorTab', () => {
  it('maps legacy profile creator tabs to dashboard tabs', () => {
    expect(parseLegacyProfileCreatorTab('wallet')).toBe('wallet')
    expect(parseLegacyProfileCreatorTab('earnings')).toBe('earnings')
    expect(parseLegacyProfileCreatorTab('stats')).toBe('stats')
    expect(parseLegacyProfileCreatorTab('nfts')).toBeNull()
    expect(parseLegacyProfileCreatorTab(null)).toBeNull()
  })
})

describe('DEFAULT_DASHBOARD_TAB', () => {
  it('defaults to earnings', () => {
    expect(DEFAULT_DASHBOARD_TAB).toBe('earnings')
  })
})
