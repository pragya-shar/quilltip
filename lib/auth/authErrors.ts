/**
 * A failed sign-in or sign-up, said plainly: which field it is about (so
 * focus goes there) and one sentence. Raw server text is never shown.
 */
export type AuthMode = 'sign-in' | 'create'

export type AuthFailure = {
  field: 'email' | 'password' | null
  message: string
}

/**
 * Every failure says plainly what did not happen: a sign-in sent nothing,
 * and a failed sign-up made no account and sent nothing.
 */
export const AUTH_MESSAGES = {
  network:
    'We could not reach Quilltip, so you are not signed in and nothing was sent. Check your connection and try again.',
  networkCreate:
    'We could not reach Quilltip, so no account was made and nothing was sent. Check your connection and try again.',
  wrongPassword: 'That email and password do not match.',
  emailInUse:
    'An account with this email already exists, so no new account was made. Sign in with it instead.',
  weakPassword:
    'Use at least 8 characters, with an uppercase letter, a lowercase letter and a number.',
  generic:
    'That did not work, so you are not signed in and nothing was sent. Try again in a moment.',
  genericCreate:
    'That did not work, so no account was made and nothing was sent. Try again in a moment.',
} as const

function messageOf(error: unknown): string {
  if (error instanceof Error) return error.message
  if (typeof error === 'string') return error
  if (
    typeof error === 'object' &&
    error !== null &&
    'data' in error &&
    typeof (error as { data: unknown }).data === 'string'
  )
    return (error as { data: string }).data
  return ''
}

export function authFailure(
  error: unknown,
  mode: AuthMode,
  online = true
): AuthFailure {
  const raw = messageOf(error)
  const lower = raw.toLowerCase()
  if (
    !online ||
    error instanceof TypeError ||
    /failed to fetch|networkerror|network request failed|load failed|connection lost|websocket/.test(
      lower
    )
  )
    return {
      field: null,
      message:
        mode === 'create' ? AUTH_MESSAGES.networkCreate : AUTH_MESSAGES.network,
    }
  if (mode === 'create') {
    if (/already exists|already registered|in use|taken/.test(lower))
      return { field: 'email', message: AUTH_MESSAGES.emailInUse }
    if (lower.includes('invalid_password') || lower.includes('password'))
      return { field: 'password', message: AUTH_MESSAGES.weakPassword }
    return { field: null, message: AUTH_MESSAGES.genericCreate }
  }
  // Signing in: whether the email exists is never told apart from a wrong
  // password.
  if (
    /invalidsecret|invalidaccountid|invalid credentials|invalid password|not found|could not verify/.test(
      lower
    )
  )
    return { field: 'password', message: AUTH_MESSAGES.wrongPassword }
  return { field: null, message: AUTH_MESSAGES.generic }
}
