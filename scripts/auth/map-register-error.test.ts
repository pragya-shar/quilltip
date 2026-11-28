import { ConvexError } from 'convex/values'
import { describe, expect, it } from 'vitest'

import { parseRegisterSignInError } from '../../lib/auth/map-register-error'

describe('sign-up error copy', () => {
  it('sends an existing email to log in or reset, on the email field', () => {
    const result = parseRegisterSignInError(new ConvexError('EMAIL_IN_USE'))
    expect(result.field).toBe('email')
    expect(result.message).toContain('log in or reset your password')
    // It never states that the account exists.
    expect(result.message).not.toMatch(/already exists|has an account/i)
  })

  it('asks to wait after too many tries, without naming the account', () => {
    const result = parseRegisterSignInError(
      new ConvexError('SIGN_UP_RATE_LIMITED')
    )
    expect(result.field).toBeUndefined()
    expect(result.message).toBe(
      'Too many tries with this email. Wait an hour, then try again.'
    )
  })

  it('keeps the generic copy for a redacted server error', () => {
    const result = parseRegisterSignInError(
      new Error('[Request ID: 1234] Server Error')
    )
    expect(result).toEqual({
      message: 'Registration failed. Please try again.',
    })
  })
})
