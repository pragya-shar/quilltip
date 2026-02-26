import * as StellarSdk from '@stellar/stellar-sdk'

/**
 * Creates a Stellar memo within the 28-byte text limit
 * Truncates IDs to fit: "a:${last26chars}", "h:${last26chars}", "n:${last26chars}"
 *
 * Future-compatible with Arweave TX IDs - will prioritize Arweave hash when available
 */
export function createMemo(params: {
  type: 'article' | 'highlight' | 'nft'
  id: string
  arweaveTxId?: string
}): StellarSdk.Memo {
  const { type, id, arweaveTxId } = params

  // Future: If Arweave TX ID exists, prioritize it (43 chars -> truncate to 28)
  if (arweaveTxId) {
    return StellarSdk.Memo.text(arweaveTxId.slice(0, 28))
  }

  // Current: Encode type + truncated ID to fit in 28 bytes
  const prefix = type === 'article' ? 'a:' : type === 'highlight' ? 'h:' : 'n:'
  const maxIdLength = 28 - prefix.length
  const truncatedId = id.slice(-maxIdLength)

  return StellarSdk.Memo.text(`${prefix}${truncatedId}`)
}
