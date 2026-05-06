import { Keypair } from '@stellar/stellar-sdk'
import { describe, expect, it } from 'vitest'
import { isValidStellarAccountId } from '@/lib/stellar/is-valid-stellar-account-id'

describe('isValidStellarAccountId', () => {
  it('accepts a random Keypair public key', () => {
    const address = Keypair.random().publicKey()
    expect(isValidStellarAccountId(address)).toBe(true)
  })

  it('accepts trimmed input', () => {
    const address = Keypair.random().publicKey()
    expect(isValidStellarAccountId(`  ${address}  `)).toBe(true)
  })

  it('rejects empty and whitespace-only', () => {
    expect(isValidStellarAccountId('')).toBe(false)
    expect(isValidStellarAccountId('   ')).toBe(false)
  })

  it('rejects short strings', () => {
    expect(isValidStellarAccountId('G')).toBe(false)
    expect(isValidStellarAccountId('GABC')).toBe(false)
  })

  it('rejects a mid-string typo in an otherwise well-formed length', () => {
    const address = Keypair.random().publicKey()
    const chars = address.split('')
    const idx = 10
    const next = chars[idx] === 'A' ? 'B' : 'A'
    chars[idx] = next
    const corrupted = chars.join('')
    expect(corrupted).not.toBe(address)
    expect(isValidStellarAccountId(corrupted)).toBe(false)
  })
})
