// Client-side helpers for the password reset journey. The email typed on the
// request step is kept in this tab's session storage so the reset step can
// prefill it; it never goes into a URL.

const EMAIL_KEY = 'quilltip.reset-email'

export const RESET_CODE_TTL_MINUTES = 15

export function rememberResetEmail(email: string) {
  try {
    window.sessionStorage.setItem(EMAIL_KEY, email.trim())
  } catch {
    // Storage blocked: the reset step asks for the email again.
  }
}

export function recallResetEmail(): string {
  try {
    return window.sessionStorage.getItem(EMAIL_KEY) ?? ''
  } catch {
    return ''
  }
}

export function forgetResetEmail() {
  try {
    window.sessionStorage.removeItem(EMAIL_KEY)
  } catch {
    // Nothing to clear.
  }
}

/** Maps a server error to copy for the request step. */
export function resetRequestErrorCopy(code: unknown): string {
  if (code === 'PASSWORD_RESET_UNAVAILABLE') {
    return 'We can’t send reset emails right now, so no code was sent. Contact us and we’ll help you back into your account.'
  }
  if (code === 'PASSWORD_RESET_RATE_LIMITED') {
    return 'Too many reset requests for this email. Wait an hour, then try again.'
  }
  return 'We couldn’t send the request. Check your connection and try again.'
}

/** Maps a server error to copy for the reset step. */
export function resetVerifyErrorCopy(code: unknown): string {
  if (code === 'PASSWORD_RESET_INVALID_CODE') {
    return 'That code is wrong, already used, or expired. Check the email and code, or request a new code.'
  }
  if (code === 'INVALID_PASSWORD') {
    return 'Choose a password that meets every requirement below.'
  }
  return 'We couldn’t reset your password. Check your connection and try again.'
}
