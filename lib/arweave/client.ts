import { TurboFactory, ArweaveSigner } from '@ardrive/turbo-sdk/node'
import { createHash } from 'crypto'
import { ARWEAVE_CONFIG } from './config'
import type {
  ArweaveArticleContent,
  ArweaveUploadResult,
  ArweaveTransactionStatus,
} from './types'
import type { JWKInterface } from 'arweave/node/lib/wallet'

/**
 * Parse and validate JWK wallet key from JSON string
 * Validates all required RSA JWK fields for security
 */
export function parseWalletKey(jwkString: string): JWKInterface {
  let parsed
  try {
    parsed = JSON.parse(jwkString)
  } catch {
    throw new Error('Invalid JWK format: not valid JSON')
  }

  // Validate all required RSA JWK fields
  const requiredFields = ['kty', 'n', 'e', 'd', 'p', 'q', 'dp', 'dq', 'qi']
  for (const field of requiredFields) {
    if (!(field in parsed)) {
      throw new Error(`Invalid JWK: missing required field '${field}'`)
    }
  }

  if (parsed.kty !== 'RSA') {
    throw new Error('Invalid JWK: must be RSA key')
  }

  // Validate key size (n should be at least 2048 bits, ~340 base64 chars)
  if (typeof parsed.n !== 'string' || parsed.n.length < 340) {
    throw new Error('Invalid JWK: key size too small (minimum 2048 bits)')
  }

  return parsed as JWKInterface
}

/**
 * Upload article content to Arweave via Turbo SDK
 * Uses server-side wallet for authenticated signing
 * FREE for files under 100 KiB
 */
export async function uploadArticle(
  content: ArweaveArticleContent,
  jwk: JWKInterface
): Promise<ArweaveUploadResult> {
  try {
    const data = JSON.stringify(content)
    const dataBuffer = Buffer.from(data)
    const contentHash = createHash('sha256').update(dataBuffer).digest('hex')
    const sizeBytes = dataBuffer.length
    const sizeKiB = sizeBytes / 1024

    // Enforce hard size limit to prevent excessive costs
    if (sizeBytes > ARWEAVE_CONFIG.HARD_LIMIT_BYTES) {
      return {
        success: false,
        error: `Article size ${sizeKiB.toFixed(1)} KiB exceeds maximum allowed (${ARWEAVE_CONFIG.HARD_LIMIT_BYTES / 1024} KiB)`,
      }
    }

    // Warn if approaching or exceeding free tier limit
    if (sizeBytes > ARWEAVE_CONFIG.FREE_TIER_LIMIT_BYTES) {
      console.warn(
        `[Arweave] Article size ${sizeKiB.toFixed(1)} KiB exceeds free tier (100 KiB). ` +
          `Upload may require credits.`
      )
    }

    // Create authenticated client with server wallet
    const signer = new ArweaveSigner(jwk)
    const turbo = TurboFactory.authenticated({ signer })

    const result = await turbo.upload({
      data: dataBuffer,
      signal: AbortSignal.timeout(60000), // 60s timeout
      dataItemOpts: {
        tags: [
          { name: 'Content-Type', value: 'application/json' },
          { name: 'App-Name', value: ARWEAVE_CONFIG.APP_NAME },
          { name: 'App-Version', value: ARWEAVE_CONFIG.APP_VERSION },
          { name: 'Article-Title', value: content.title },
          { name: 'Author', value: content.author },
          { name: 'Author-Id', value: content.authorId },
          { name: 'Timestamp', value: content.timestamp.toString() },
          { name: 'Version', value: content.version.toString() },
          { name: 'Content-Hash', value: contentHash },
        ],
      },
    })

    return {
      success: true,
      txId: result.id,
      url: `https://arweave.net/${result.id}`,
      contentHash,
    }
  } catch (error) {
    console.error('[Arweave] Upload error:', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    }
  }
}

/**
 * Get article content from Arweave by transaction ID
 */
export async function getArticle(
  txId: string
): Promise<ArweaveArticleContent | null> {
  try {
    const response = await fetch(`https://arweave.net/${txId}`)
    if (!response.ok) return null
    return (await response.json()) as ArweaveArticleContent
  } catch {
    return null
  }
}

/**
 * Check transaction status (for verification)
 * For bundled transactions (Turbo SDK), checks multiple gateways in parallel
 */
export async function getTransactionStatus(
  txId: string
): Promise<ArweaveTransactionStatus> {
  const timeoutMs = ARWEAVE_CONFIG.GATEWAY_TIMEOUT_MS

  try {
    // First try main gateway for block confirmation with timeout
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs)

    try {
      const response = await fetch(`https://arweave.net/tx/${txId}/status`, {
        signal: controller.signal,
      })
      clearTimeout(timeoutId)

      if (response.ok) {
        const status = await response.json()
        if (status.block_height) {
          return {
            confirmed: true,
            confirmations: status.number_of_confirmations || 0,
            blockHeight: status.block_height,
          }
        }
      }
    } catch (error) {
      clearTimeout(timeoutId)
      if (error instanceof Error && error.name === 'AbortError') {
        console.warn('[Arweave] Main gateway verification timeout')
      }
      // Continue to fallback gateways
    }

    // For bundled transactions, check alternative gateways in parallel
    // If accessible, consider it confirmed (data is permanently stored)
    const gateways = [
      `https://arweave.developerdao.com/${txId}`,
      `https://g8way.io/${txId}`,
    ]

    const gatewayChecks = gateways.map(async (url) => {
      const ctrl = new AbortController()
      const timeout = setTimeout(() => ctrl.abort(), timeoutMs / 2) // Shorter timeout for fallbacks
      try {
        const res = await fetch(url, { method: 'HEAD', signal: ctrl.signal })
        clearTimeout(timeout)
        return res.ok
      } catch {
        clearTimeout(timeout)
        return false
      }
    })

    const results = await Promise.allSettled(gatewayChecks)
    const anyConfirmed = results.some(
      (r) => r.status === 'fulfilled' && r.value === true
    )

    if (anyConfirmed) {
      return { confirmed: true, confirmations: 1 }
    }

    return { confirmed: false, confirmations: 0 }
  } catch {
    return { confirmed: false, confirmations: 0 }
  }
}
