import { describe, it, expect } from 'vitest'
import {
  mapRegisterSignInError,
  parseRegisterSignInError,
} from './map-register-error'

describe('mapRegisterSignInError', () => {
  it('maps duplicate account messages from Convex-style errors', () => {
    const msg = `[CONVEX A(auth:signIn)] Server Error Uncaught Error: Account user@example.com already exists at createAccountFromCredentialsImpl`
    expect(mapRegisterSignInError(new Error(msg))).toBe(
      'An account with this email already exists. Try signing in, or use a different email.'
    )
  })

  it('maps plain duplicate wording', () => {
    expect(mapRegisterSignInError(new Error('Account already exists'))).toBe(
      'An account with this email already exists. Try signing in, or use a different email.'
    )
  })

  it('maps Convex wrapper without duplicate to generic', () => {
    const msg = `[CONVEX A(auth:signIn)] [Request ID: abc] Server Error Something went wrong`
    expect(mapRegisterSignInError(new Error(msg))).toBe(
      'Registration failed. Please try again.'
    )
  })

  it('maps multiline errors to generic', () => {
    expect(mapRegisterSignInError(new Error('line1\nline2'))).toBe(
      'Registration failed. Please try again.'
    )
  })

  it('passes through a short single-line client message', () => {
    expect(
      mapRegisterSignInError(new Error('Sign up is temporarily disabled.'))
    ).toBe('Sign up is temporarily disabled.')
  })

  it('maps username conflict phrasing when present', () => {
    expect(
      mapRegisterSignInError(new Error('Username "foo" is already taken'))
    ).toBe('This username is not available. Try another one.')
  })

  it('maps username already exists before generic duplicate account wording', () => {
    expect(mapRegisterSignInError(new Error('Username already exists'))).toBe(
      'This username is not available. Try another one.'
    )
  })
})

describe('parseRegisterSignInError', () => {
  it('associates duplicate account errors with the email field', () => {
    expect(
      parseRegisterSignInError(new Error('Account already exists'))
    ).toEqual({
      message:
        'An account with this email already exists. Try signing in, or use a different email.',
      field: 'email',
    })
  })

  it('associates username conflicts with the username field', () => {
    expect(
      parseRegisterSignInError(new Error('Username "foo" is already taken'))
    ).toEqual({
      message: 'This username is not available. Try another one.',
      field: 'username',
    })
  })

  it('returns a form-level generic error without a field', () => {
    expect(
      parseRegisterSignInError(
        new Error('[CONVEX A(auth:signIn)] Server Error Something went wrong')
      )
    ).toEqual({
      message: 'Registration failed. Please try again.',
    })
  })
})
