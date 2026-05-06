import { StrKey } from '@stellar/stellar-sdk'

export function isValidStellarAccountId(value: string): boolean {
  const trimmed = value.trim()
  if (!trimmed) return false
  return StrKey.isValidEd25519PublicKey(trimmed)
}
