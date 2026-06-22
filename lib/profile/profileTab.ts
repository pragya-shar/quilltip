export const PROFILE_TAB_IDS = ['articles', 'nfts'] as const

export type ProfileTabId = (typeof PROFILE_TAB_IDS)[number]

const LEGACY_CREATOR_TABS = ['wallet', 'earnings', 'stats'] as const

export type LegacyCreatorTabId = (typeof LEGACY_CREATOR_TABS)[number]

export function isLegacyCreatorTab(
  raw: string | null
): raw is LegacyCreatorTabId {
  return LEGACY_CREATOR_TABS.includes(raw as LegacyCreatorTabId)
}

export function parseProfileTab(raw: string | null): ProfileTabId {
  if (!raw) return 'articles'
  if (!PROFILE_TAB_IDS.includes(raw as ProfileTabId)) return 'articles'
  return raw as ProfileTabId
}

export function buildProfileTabHref(
  pathname: string,
  searchParams: URLSearchParams,
  tab: ProfileTabId
): string {
  const next = new URLSearchParams(searchParams.toString())
  if (tab === 'articles') next.delete('tab')
  else next.set('tab', tab)
  const qs = next.toString()
  return qs ? `${pathname}?${qs}` : pathname
}

export function profileTabUrlIsCanonical(raw: string | null): boolean {
  if (!raw) return true
  if (isLegacyCreatorTab(raw)) return false
  const tab = parseProfileTab(raw)
  if (tab === 'articles') return false
  return tab === raw
}

export function buildCurrentProfilePath(
  pathname: string,
  searchParams: URLSearchParams
): string {
  const qs = searchParams.toString()
  return qs ? `${pathname}?${qs}` : pathname
}
