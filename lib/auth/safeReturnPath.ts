/**
 * Validates a post-auth return path from query params.
 * Only same-origin relative paths are allowed (open-redirect protection).
 */
export function getSafeReturnPath(
  returnTo: string | null | undefined,
  fallback = '/'
): string {
  if (!returnTo || typeof returnTo !== 'string') {
    return fallback
  }

  const trimmed = returnTo.trim()
  if (trimmed.length === 0) {
    return fallback
  }

  if (!trimmed.startsWith('/')) {
    return fallback
  }

  if (trimmed.startsWith('//')) {
    return fallback
  }

  const lower = trimmed.toLowerCase()
  if (
    lower.startsWith('http:') ||
    lower.startsWith('https:') ||
    lower.startsWith('javascript:') ||
    lower.startsWith('data:') ||
    lower.startsWith('vbscript:')
  ) {
    return fallback
  }

  if (trimmed.includes('\\')) {
    return fallback
  }

  return trimmed
}

export function buildLoginHref(returnPath: string): string {
  const safe = getSafeReturnPath(returnPath)
  return `/login?returnTo=${encodeURIComponent(safe)}`
}

export function buildRegisterHref(returnPath: string): string {
  const safe = getSafeReturnPath(returnPath)
  return `/register?returnTo=${encodeURIComponent(safe)}`
}
