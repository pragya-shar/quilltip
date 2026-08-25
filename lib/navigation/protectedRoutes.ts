const PROTECTED_PREFIXES = [
  '/write',
  '/drafts',
  '/dashboard',
  '/profile',
  '/settings/profile',
] as const

export function isProtectedPath(pathname: string): boolean {
  return PROTECTED_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`)
  )
}
