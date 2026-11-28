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

/** The permanent-storage fields stored on an article. */
type StoredStorageFields = {
  arweaveStatus?: string
  arweaveTxId?: string
  arweaveUrl?: string
  arweaveTimestamp?: number
  arweaveErrorMessage?: string
  arweaveVerifyAttempts?: number
}

/**
 * The permanent-storage fields a viewer gets (#679). Spread it after the
 * article document so it replaces the stored fields.
 *
 * - A finished upload (`verified`) is public: status, transaction, link and
 *   time go to everyone.
 * - Anything else (pending, uploaded, failed or unknown) is the writer's
 *   business: a reader gets no storage fields at all, so no reader surface
 *   can show an upload in progress or a failed one.
 * - The writer gets the stored status, except a `pending` left over while
 *   permanent storage is off: nothing uploads it, so it says nothing.
 * - The error message and retry count never leave the backend.
 *
 * The stored row is unchanged.
 */
export function storageForViewer(
  article: StoredStorageFields,
  isOwner: boolean,
  enabled: boolean = permanentStorageEnabled()
): {
  arweaveStatus: string | undefined
  arweaveTxId: string | undefined
  arweaveUrl: string | undefined
  arweaveTimestamp: number | undefined
  arweaveErrorMessage: undefined
  arweaveVerifyAttempts: undefined
} {
  const hidden = {
    arweaveStatus: undefined,
    arweaveTxId: undefined,
    arweaveUrl: undefined,
    arweaveTimestamp: undefined,
    arweaveErrorMessage: undefined,
    arweaveVerifyAttempts: undefined,
  }
  const status = article.arweaveStatus
  const shown =
    status === 'verified' ||
    (isOwner && status !== undefined && !(status === 'pending' && !enabled))
  if (!shown) return hidden
  return {
    ...hidden,
    arweaveStatus: status,
    arweaveTxId: article.arweaveTxId,
    arweaveUrl: article.arweaveUrl,
    arweaveTimestamp: article.arweaveTimestamp,
  }
}

/** Lets the publish dialog say whether the article will be stored permanently. */
export const isEnabled = query({
  args: {},
  returns: v.boolean(),
  handler: async () => permanentStorageEnabled(),
})
