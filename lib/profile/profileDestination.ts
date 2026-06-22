import {
  getDashboardTabPath,
  parseLegacyProfileCreatorTab,
} from '@/lib/dashboard/dashboardTab'
import {
  buildProfileTabHref,
  parseProfileTab,
  type ProfileTabId,
} from './profileTab'

export const GENERIC_PROFILE_PATHS = ['/profile', '/settings/profile'] as const

export type GenericProfilePath = (typeof GENERIC_PROFILE_PATHS)[number]

export function buildGenericProfilePath(tab?: ProfileTabId | string): string {
  const legacyTab = parseLegacyProfileCreatorTab(tab ?? null)
  if (legacyTab) {
    return getDashboardTabPath(legacyTab)
  }
  if (!tab || tab === 'articles') return '/profile'
  const profileTab = parseProfileTab(typeof tab === 'string' ? tab : tab)
  if (profileTab === 'articles') return '/profile'
  return `/profile?tab=${profileTab}`
}

export function resolveProfileAliasPath(
  pathname: string,
  searchParams: URLSearchParams,
  username?: string | null
): string {
  const legacyTab = parseLegacyProfileCreatorTab(searchParams.get('tab'))
  if (legacyTab) {
    return getDashboardTabPath(legacyTab)
  }

  if (username) {
    return resolveSignedInProfilePath(username, searchParams)
  }

  return buildPathWithSearch(pathname, searchParams)
}

export function resolveSignedInProfilePath(
  username: string,
  searchParams: URLSearchParams
): string {
  const legacyTab = parseLegacyProfileCreatorTab(searchParams.get('tab'))
  if (legacyTab) {
    return getDashboardTabPath(legacyTab)
  }

  const pathname = `/${username}`
  const tab = parseProfileTab(searchParams.get('tab'))
  return buildProfileTabHref(pathname, searchParams, tab)
}

export function buildLoginRedirectPath(intendedPath: string): string {
  const params = new URLSearchParams()
  params.set('next', intendedPath)
  return `/login?${params.toString()}`
}

export function parseSafeNextParam(
  next: string | null | undefined
): string | null {
  if (!next) return null
  if (!next.startsWith('/') || next.startsWith('//')) return null
  if (next.includes('://')) return null
  return next
}

export function buildPathWithSearch(
  pathname: string,
  searchParams: URLSearchParams
): string {
  const qs = searchParams.toString()
  return qs ? `${pathname}?${qs}` : pathname
}

export function appendNextToAuthPath(
  authPath: '/login' | '/register',
  next: string | null | undefined
): string {
  const safe = parseSafeNextParam(next)
  if (!safe) return authPath
  const params = new URLSearchParams()
  params.set('next', safe)
  return `${authPath}?${params.toString()}`
}
