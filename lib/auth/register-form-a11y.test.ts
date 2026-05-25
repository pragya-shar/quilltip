import { describe, it, expect } from 'vitest'
import { getFirstRegisterFieldError } from './register-form-a11y'

describe('getFirstRegisterFieldError', () => {
  it('returns the first error in registration field order', () => {
    const result = getFirstRegisterFieldError({
      confirmPassword: { type: 'custom', message: "Passwords don't match" },
      email: { type: 'required', message: 'Email is required' },
      password: {
        type: 'min',
        message: 'Password must be at least 8 characters',
      },
    })

    expect(result).toEqual({
      field: 'email',
      message: 'Email is required',
    })
  })

  it('skips fields without messages', () => {
    const result = getFirstRegisterFieldError({
      email: { type: 'required', message: '' },
      username: {
        type: 'min',
        message: 'Username must be at least 3 characters',
      },
    })

    expect(result).toEqual({
      field: 'username',
      message: 'Username must be at least 3 characters',
    })
  })

  it('returns null when there are no errors', () => {
    expect(getFirstRegisterFieldError({})).toBeNull()
  })
})
