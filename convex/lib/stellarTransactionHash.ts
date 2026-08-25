const STELLAR_TRANSACTION_HASH = /^[0-9a-fA-F]{64}$/

export function normalizeStellarTransactionHash(value: string): string | null {
  if (!STELLAR_TRANSACTION_HASH.test(value)) return null
  return value.toLowerCase()
}

export function stellarTransactionHashLookupValues(value: string): string[] {
  const normalized = normalizeStellarTransactionHash(value)
  if (!normalized) return []
  return [...new Set([normalized, normalized.toUpperCase()])]
}
