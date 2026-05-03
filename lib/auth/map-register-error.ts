const DUPLICATE_ACCOUNT =
  'An account with this email already exists. Try signing in, or use a different email.'

const USERNAME_UNAVAILABLE = 'This username is not available. Try another one.'

const GENERIC = 'Registration failed. Please try again.'

/**
 * Maps Convex Auth / network failures from sign-up into short user-facing copy.
 * Avoids showing raw stack traces or `[CONVEX ...]` payloads in the UI.
 */
export function mapRegisterSignInError(error: unknown): string {
  const raw = extractMessage(error)
  const lower = raw.toLowerCase()

  if (
    lower.includes('already exists') ||
    lower.includes('already registered') ||
    /email.+?\b(in use|taken)\b/i.test(raw)
  ) {
    return DUPLICATE_ACCOUNT
  }

  if (
    /\busername\b.+?\b(already|taken|in use|unavailable)\b/i.test(raw) ||
    lower.includes('username is not available') ||
    lower.includes('username not available')
  ) {
    return USERNAME_UNAVAILABLE
  }

  if (
    lower.includes('[convex') ||
    lower.includes('uncaught error') ||
    lower.includes('server error') ||
    lower.includes('request id:') ||
    raw.includes('\n')
  ) {
    return GENERIC
  }

  if (raw.length > 0 && raw.length <= 200 && !looksLikeStackSnippet(raw)) {
    return raw
  }

  return GENERIC
}

function extractMessage(error: unknown): string {
  if (error instanceof Error) return error.message.trim()
  if (typeof error === 'string') return error.trim()
  return ''
}

function looksLikeStackSnippet(message: string): boolean {
  return /\bat\s+[\w./$-]+:\d+/i.test(message)
}
