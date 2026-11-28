import { v } from 'convex/values'
import { query } from './_generated/server'

/**
 * True when publishing on this deployment uploads the article to permanent
 * storage (Arweave): `ARWEAVE_ENABLED` is `true` and the upload wallet is
 * configured, the same conditions `arweave:uploadArticleToArweave` needs.
 * Returns a boolean only; no configuration value leaves the backend.
 */
export function permanentStorageEnabled(): boolean {
  return (
    process.env.ARWEAVE_ENABLED === 'true' && !!process.env.ARWEAVE_WALLET_KEY
  )
}

/**
 * The storage status a reader sees. With permanent storage off, nothing
 * uploads a `pending` article (the upload action returns at once), so that
 * status is a leftover and readers see no status. The stored row is unchanged.
 */
export function readableArweaveStatus(
  status: string | undefined
): string | undefined {
  if (status === 'pending' && !permanentStorageEnabled()) return undefined
  return status
}

/** Lets the publish dialog say whether the article will be stored permanently. */
export const isEnabled = query({
  args: {},
  returns: v.boolean(),
  handler: async () => permanentStorageEnabled(),
})
