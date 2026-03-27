import { describe, expect, it } from 'vitest'
import { avatarInitials } from './user-avatar'

describe('avatarInitials', () => {
  it('returns first letter uppercased', () => {
    expect(avatarInitials('jane')).toBe('J')
    expect(avatarInitials('Jane Doe')).toBe('J')
  })

  it('returns ? for empty or whitespace', () => {
    expect(avatarInitials('')).toBe('?')
    expect(avatarInitials('   ')).toBe('?')
  })

  it('handles single character', () => {
    expect(avatarInitials('x')).toBe('X')
  })
})
