import { loadStellarSdk } from './sdk-loader'

/**
 * Creates a Stellar memo within the 28-byte text limit
 * Truncates IDs to fit: "a:${last26chars}", "h:${last26chars}", "n:${last26chars}"
 *
 * Future-compatible with Arweave TX IDs - will prioritize Arweave hash when available
 */
export async function createMemo(params: {
  type: 'article' | 'highlight' | 'nft'
  id: string
  arweaveTxId?: string
}): Promise<import('@stellar/stellar-sdk').Memo> {
  const StellarSdk = await loadStellarSdk()
  const { type, id, arweaveTxId } = params

  if (arweaveTxId) {
    return StellarSdk.Memo.text(arweaveTxId.slice(0, 28))
  }

  const prefix = type === 'article' ? 'a:' : type === 'highlight' ? 'h:' : 'n:'
  const maxIdLength = 28 - prefix.length
  const truncatedId = id.slice(-maxIdLength)

  return StellarSdk.Memo.text(`${prefix}${truncatedId}`)
}
