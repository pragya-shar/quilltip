const DUPLICATE_ACCOUNT =
  'An account with this email already exists. Try signing in, or use a different email.'

const USERNAME_UNAVAILABLE = 'This username is not available. Try another one.'

const GENERIC = 'Registration failed. Please try again.'

export type RegisterSignInErrorField = 'email' | 'username'

export type RegisterSignInErrorResult = {
  message: string
  field?: RegisterSignInErrorField
}

/**
 * Maps Convex Auth / network failures from sign-up into short user-facing copy.
 * Avoids showing raw stack traces or `[CONVEX ...]` payloads in the UI.
 */
export function parseRegisterSignInError(
  error: unknown
): RegisterSignInErrorResult {
  const raw = extractMessage(error)
  const lower = raw.toLowerCase()

  if (
    /\busername\b.+?\b(already|taken|in use|unavailable|exists)\b/i.test(raw) ||
    lower.includes('username is not available') ||
    lower.includes('username not available') ||
    lower.includes('username already exists')
  ) {
    return { message: USERNAME_UNAVAILABLE, field: 'username' }
  }

  if (
    lower.includes('already exists') ||
    lower.includes('already registered') ||
    /email.+?\b(in use|taken)\b/i.test(raw)
  ) {
    return { message: DUPLICATE_ACCOUNT, field: 'email' }
  }

  if (
    lower.includes('[convex') ||
    lower.includes('uncaught error') ||
    lower.includes('server error') ||
    lower.includes('request id:') ||
    raw.includes('\n')
  ) {
    return { message: GENERIC }
  }

  if (raw.length > 0 && raw.length <= 200 && !looksLikeStackSnippet(raw)) {
    return { message: raw }
  }

  return { message: GENERIC }
}

export function mapRegisterSignInError(error: unknown): string {
  return parseRegisterSignInError(error).message
}

function extractMessage(error: unknown): string {
  if (error instanceof Error) return error.message.trim()
  if (typeof error === 'string') return error.trim()
  return ''
}

function looksLikeStackSnippet(message: string): boolean {
  return /\bat\s+[\w./$-]+:\d+/i.test(message)
}
