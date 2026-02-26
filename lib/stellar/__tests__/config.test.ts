import { describe, it, expect } from 'vitest'
import { z } from 'zod'

// Test the Stellar address pattern used in config validation
const stellarAddressSchema = z
  .string()
  .regex(/^[GC][A-Z0-9]{55}$/, 'Invalid Stellar address format')

describe('Stellar Config Validation', () => {
  describe('stellarAddressSchema', () => {
    it('accepts valid Stellar public key (G...)', () => {
      // Valid Stellar public key format (56 chars, starts with G)
      const validPublicKey =
        'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF'
      const result = stellarAddressSchema.safeParse(validPublicKey)
      expect(result.success).toBe(true)
    })

    it('accepts valid Stellar contract ID (C...)', () => {
      // Valid Soroban contract ID format (56 chars, starts with C)
      const validContractId =
        'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4'
      const result = stellarAddressSchema.safeParse(validContractId)
      expect(result.success).toBe(true)
    })

    it('rejects address with wrong prefix', () => {
      const invalidAddress =
        'XAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF'
      const result = stellarAddressSchema.safeParse(invalidAddress)
      expect(result.success).toBe(false)
    })

    it('rejects address with wrong length', () => {
      const tooShort = 'GAAAAAAAAAAAAAAAA'
      const result = stellarAddressSchema.safeParse(tooShort)
      expect(result.success).toBe(false)
    })

    it('rejects address with lowercase characters', () => {
      const lowercaseAddress =
        'Gaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaawhf'
      const result = stellarAddressSchema.safeParse(lowercaseAddress)
      expect(result.success).toBe(false)
    })

    it('rejects empty string', () => {
      const result = stellarAddressSchema.safeParse('')
      expect(result.success).toBe(false)
    })

    it('allows undefined (optional validation)', () => {
      const optionalSchema = stellarAddressSchema.optional()
      const result = optionalSchema.safeParse(undefined)
      expect(result.success).toBe(true)
    })
  })

  describe('XLM rate configuration', () => {
    it('has reasonable fallback rate', async () => {
      // Fallback rate should be between $0.01 and $10 (sanity check)
      const { STELLAR_CONFIG } = await import('@/lib/stellar/config')
      expect(STELLAR_CONFIG.XLM_TO_USD_RATE).toBeGreaterThan(0.01)
      expect(STELLAR_CONFIG.XLM_TO_USD_RATE).toBeLessThan(10)
    })

    it('has minimum tip in reasonable range', async () => {
      const { STELLAR_CONFIG } = await import('@/lib/stellar/config')
      // Minimum tip should be at least 1000 stroops (0.0001 XLM)
      expect(STELLAR_CONFIG.MINIMUM_TIP_STROOPS).toBeGreaterThan(1000)
      // And less than 10 XLM worth
      expect(STELLAR_CONFIG.MINIMUM_TIP_STROOPS).toBeLessThan(100_000_000)
    })
  })
})
