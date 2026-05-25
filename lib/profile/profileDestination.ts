import {
  buildProfileTabHref,
  parseProfileTab,
  type ProfileTabId,
} from './profileTab'

export const GENERIC_PROFILE_PATHS = ['/profile', '/settings/profile'] as const

export type GenericProfilePath = (typeof GENERIC_PROFILE_PATHS)[number]

export function buildGenericProfilePath(tab?: ProfileTabId): string {
  if (!tab || tab === 'articles') return '/profile'
  return `/profile?tab=${tab}`
}

export function resolveSignedInProfilePath(
  username: string,
  searchParams: URLSearchParams
): string {
  const pathname = `/${username}`
  const tab = parseProfileTab(searchParams.get('tab'), true)
  return buildProfileTabHref(pathname, searchParams, tab)
}

export function buildLoginRedirectPath(intendedPath: string): string {
  const params = new URLSearchParams()
  params.set('next', intendedPath)
  return `/login?${params.toString()}`
}

export function parseSafeNextParam(next: string | null | undefined): string | null {
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
