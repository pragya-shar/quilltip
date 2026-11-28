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

  if (
    Array.from(returnTo).some(
      (char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127
    )
  )
    return fallback

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

/**
 * Reads the post-auth return path from `redirect`, then `returnTo`, then
 * `next`; the first safe value wins.
 */
export function resolveAuthReturnPath(params: {
  get(name: string): string | null
}): string {
  return getSafeReturnPath(
    params.get('redirect'),
    getSafeReturnPath(
      params.get('returnTo'),
      getSafeReturnPath(params.get('next'))
    )
  )
}

/** Adapts Next.js page `searchParams` to the `get` shape used above. */
export function searchParamsRecordReader(
  record: Record<string, string | string[] | undefined>
): { get(name: string): string | null } {
  return {
    get(name) {
      const value = record[name]
      return (Array.isArray(value) ? value[0] : value) ?? null
    },
  }
}

export function getCurrentReturnPath(
  pathname: string,
  searchParams: URLSearchParams | { toString(): string }
): string {
  const qs = searchParams.toString()
  return qs ? `${pathname}?${qs}` : pathname
}

export function buildLoginHref(returnPath: string): string {
  const safe = getSafeReturnPath(returnPath)
  return `/login?returnTo=${encodeURIComponent(safe)}`
}

export function buildRegisterHref(returnPath: string): string {
  const safe = getSafeReturnPath(returnPath)
  return `/register?returnTo=${encodeURIComponent(safe)}`
}
