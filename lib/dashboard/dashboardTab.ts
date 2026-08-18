export const DASHBOARD_TAB_IDS = ['wallet', 'stats'] as const

export type DashboardTabId = (typeof DASHBOARD_TAB_IDS)[number]

export const DEFAULT_DASHBOARD_TAB: DashboardTabId = 'stats'

export function isDashboardTabId(raw: string | null): raw is DashboardTabId {
  return DASHBOARD_TAB_IDS.includes(raw as DashboardTabId)
}

export function getDashboardTabPath(tab: DashboardTabId): string {
  return `/dashboard/${tab}`
}

export function parseLegacyProfileCreatorTab(
  raw: string | null
): DashboardTabId | null {
  if (!raw) return null
  if (raw === 'earnings') return 'stats'
  if (raw === 'wallet' || raw === 'stats') {
    return raw
  }
  return null
}
