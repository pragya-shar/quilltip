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

/** Lets the publish dialog say whether the article will be stored permanently. */
export const isEnabled = query({
  args: {},
  returns: v.boolean(),
  handler: async () => permanentStorageEnabled(),
})
