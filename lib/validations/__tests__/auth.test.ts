import { describe, it, expect } from 'vitest'
import {
  loginSchema,
  registerSchema,
  profileUpdateSchema,
  passwordChangeSchema,
} from '../auth'

describe('Auth Validation Schemas', () => {
  describe('loginSchema', () => {
    it('accepts valid login data', () => {
      const result = loginSchema.safeParse({
        email: 'user@example.com',
        password: 'password123',
      })
      expect(result.success).toBe(true)
    })

    it('rejects invalid email', () => {
      const result = loginSchema.safeParse({
        email: 'invalid-email',
        password: 'password123',
      })
      expect(result.success).toBe(false)
    })

    it('rejects empty password', () => {
      const result = loginSchema.safeParse({
        email: 'user@example.com',
        password: '',
      })
      expect(result.success).toBe(false)
    })
  })

  describe('registerSchema', () => {
    it('accepts valid registration data', () => {
      const result = registerSchema.safeParse({
        email: 'user@example.com',
        username: 'validuser',
        password: 'Password1',
        confirmPassword: 'Password1',
      })
      expect(result.success).toBe(true)
    })

    it('rejects password without uppercase', () => {
      const result = registerSchema.safeParse({
        email: 'user@example.com',
        username: 'validuser',
        password: 'password1',
        confirmPassword: 'password1',
      })
      expect(result.success).toBe(false)
    })

    it('rejects mismatched passwords', () => {
      const result = registerSchema.safeParse({
        email: 'user@example.com',
        username: 'validuser',
        password: 'Password1',
        confirmPassword: 'Password2',
      })
      expect(result.success).toBe(false)
    })

    it('rejects invalid username characters', () => {
      const result = registerSchema.safeParse({
        email: 'user@example.com',
        username: 'invalid user!',
        password: 'Password1',
        confirmPassword: 'Password1',
      })
      expect(result.success).toBe(false)
    })

    it('accepts registration without profile name', () => {
      const result = registerSchema.safeParse({
        email: 'user@example.com',
        username: 'validuser',
        password: 'Password1',
        confirmPassword: 'Password1',
      })
      expect(result.success).toBe(true)
    })

    it('rejects empty email with a clear message', () => {
      const result = registerSchema.safeParse({
        email: '',
        username: 'validuser',
        password: 'Password1',
        confirmPassword: 'Password1',
      })
      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.issues[0]?.message).toBe('Email is required')
      }
    })

    it('rejects empty username', () => {
      const result = registerSchema.safeParse({
        email: 'user@example.com',
        username: '',
        password: 'Password1',
        confirmPassword: 'Password1',
      })
      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.issues[0]?.message).toBe(
          'Username must be at least 3 characters'
        )
      }
    })

    it('rejects empty password', () => {
      const result = registerSchema.safeParse({
        email: 'user@example.com',
        username: 'validuser',
        password: '',
        confirmPassword: '',
      })
      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.issues[0]?.message).toBe(
          'Password must be at least 8 characters'
        )
      }
    })
  })

  describe('profileUpdateSchema', () => {
    it('accepts valid profile update', () => {
      const result = profileUpdateSchema.safeParse({
        name: 'John Doe',
        bio: 'A short bio',
      })
      expect(result.success).toBe(true)
    })

    it('rejects bio over 500 characters', () => {
      const result = profileUpdateSchema.safeParse({
        bio: 'a'.repeat(501),
      })
      expect(result.success).toBe(false)
    })
  })

  describe('passwordChangeSchema', () => {
    it('rejects same old and new password', () => {
      const result = passwordChangeSchema.safeParse({
        currentPassword: 'Password1',
        newPassword: 'Password1',
        confirmNewPassword: 'Password1',
      })
      expect(result.success).toBe(false)
    })
  })
})
