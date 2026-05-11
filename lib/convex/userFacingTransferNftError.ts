const GENERIC = 'Transfer could not be completed. Please try again.'

const FRIENDLY_BY_SUBSTRING: Array<{ match: string; message: string }> = [
  {
    match: 'recipient not found',
    message: 'No account uses that username. Check the spelling and try again.',
  },
  {
    match: 'not authenticated',
    message: 'Sign in to transfer this NFT.',
  },
  {
    match: 'nft not found',
    message: 'This NFT could not be found. Refresh the page and try again.',
  },
  {
    match: "you don't own this nft",
    message: 'Only the current owner can transfer this NFT.',
  },
  {
    match: 'cannot transfer to yourself',
    message: 'Pick a different recipient.',
  },
  {
    match: 'user not found',
    message: 'Your session could not be verified. Please sign in again.',
  },
]

function extractRawMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  if (typeof error === 'string') return error
  return ''
}

function extractInnerFromDevWrapper(message: string): string | null {
  const uncaught = message.match(
    /Uncaught Error:\s*([\s\S]+?)(?:\s+at\s+handler|\s+Called by client|$)/i
  )
  if (uncaught?.[1]) {
    const inner = uncaught[1].trim()
    if (inner.length > 0) return inner
  }
  return null
}

function looksLikeDevNoise(message: string): boolean {
  if (/\[CONVEX/i.test(message)) return true
  if (/Request ID:/i.test(message)) return true
  if (/\bnfts:transferNFT\b/i.test(message)) return true
  if (/\.\.\/convex\//i.test(message)) return true
  if (/\bcalled by client\b/i.test(message)) return true
  return /\bat\s+[\w./$-]+:\d+/i.test(message)
}

function polishKnownMessage(inner: string): string | null {
  const n = inner.trim().toLowerCase()
  for (const { match, message } of FRIENDLY_BY_SUBSTRING) {
    if (n.includes(match)) return message
  }
  return null
}

/**
 * Maps Convex / network errors from transferNFT into short copy for toasts.
 * Avoids showing `[CONVEX ...]`, request IDs, or file paths to users.
 */
export function userFacingTransferNftError(error: unknown): string {
  const raw = extractRawMessage(error)
  const inner = extractInnerFromDevWrapper(raw) ?? raw.trim()

  const polished = polishKnownMessage(inner)
  if (polished) return polished

  if (inner.length > 0 && inner.length <= 200 && !looksLikeDevNoise(inner)) {
    return inner
  }

  return GENERIC
}
