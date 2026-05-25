import { describe, it, expect } from 'vitest'
import {
  allPasswordRulesMet,
  getPasswordRuleStatuses,
} from '../password-rules'

describe('password-rules', () => {
  describe('getPasswordRuleStatuses', () => {
    it('returns all rules unmet for an empty password', () => {
      const statuses = getPasswordRuleStatuses('')
      expect(statuses).toHaveLength(4)
      expect(statuses.every((rule) => !rule.met)).toBe(true)
    })

    it('marks minLength met when password has 8+ characters', () => {
      const statuses = getPasswordRuleStatuses('12345678')
      expect(statuses.find((r) => r.id === 'minLength')?.met).toBe(true)
      expect(statuses.find((r) => r.id === 'uppercase')?.met).toBe(false)
      expect(statuses.find((r) => r.id === 'lowercase')?.met).toBe(false)
      expect(statuses.find((r) => r.id === 'digit')?.met).toBe(true)
    })

    it('marks all rules met for a valid password', () => {
      const statuses = getPasswordRuleStatuses('Password1')
      expect(statuses.every((rule) => rule.met)).toBe(true)
    })
  })

  describe('allPasswordRulesMet', () => {
    it('returns false when any rule is unmet', () => {
      expect(allPasswordRulesMet('password')).toBe(false)
      expect(allPasswordRulesMet('PASSWORD1')).toBe(false)
      expect(allPasswordRulesMet('Pass1')).toBe(false)
    })

    it('returns true when all rules are met', () => {
      expect(allPasswordRulesMet('Password1')).toBe(true)
    })
  })
})
