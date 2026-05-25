export const PROFILE_TAB_IDS = [
  'articles',
  'nfts',
  'wallet',
  'earnings',
  'stats',
] as const

export type ProfileTabId = (typeof PROFILE_TAB_IDS)[number]

const PUBLIC_TABS: ProfileTabId[] = ['articles', 'nfts', 'wallet']
const OWN_PROFILE_TABS: ProfileTabId[] = ['earnings', 'stats']

export function parseProfileTab(
  raw: string | null,
  isOwnProfile: boolean
): ProfileTabId {
  if (!raw) return 'articles'
  if (!PROFILE_TAB_IDS.includes(raw as ProfileTabId)) return 'articles'
  const tab = raw as ProfileTabId
  if (PUBLIC_TABS.includes(tab)) return tab
  if (isOwnProfile && OWN_PROFILE_TABS.includes(tab)) return tab
  return 'articles'
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
