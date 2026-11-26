/**
 * Handlers for article NFT contract events (contracts/article-nft/src/events.rs,
 * OpenZeppelin stellar-tokens 0.8.0; docs/architecture/v2/06-app-integration.md,
 * section 6.5).
 *
 * `article_nft_minted` and `transfer` update `articleNFTs` and `nftTransfers`
 * through convex/lib/chain/nftStore.ts. They are idempotent per event ID and
 * safe to replay or reorder. The other NFT events are stored for the record.
 */
import type { ChainEventHandler, HandlerResult } from './indexerStore'
import { EventDecodeError } from './events'
import {
  NFT_MINTED_EVENT,
  NFT_TRANSFER_EVENT,
  nftEventFacts,
  type NftEventFacts,
} from './nftEvents'
import {
  NftStoreConflict,
  applyMintedEvent,
  applyTransferEvent,
  eventContext,
} from './nftStore'

function logged(
  code: string,
  event: Parameters<ChainEventHandler>[1],
  message: string
): HandlerResult {
  console.error(
    JSON.stringify({
      code,
      eventId: event.doc.eventId,
      type: event.doc.type,
      message,
    })
  )
  return 'error'
}

function guarded(
  name: string,
  apply: (
    ctx: Parameters<ChainEventHandler>[0],
    event: Parameters<ChainEventHandler>[1],
    facts: NftEventFacts
  ) => Promise<HandlerResult>
): ChainEventHandler {
  return async (ctx, event) => {
    let facts: NftEventFacts | null
    try {
      facts = nftEventFacts({
        name: event.doc.type,
        topics: event.doc.topics,
        data: event.doc.data,
      })
    } catch (error) {
      if (error instanceof EventDecodeError) {
        return logged('CHAIN_INDEXER_MALFORMED_EVENT', event, error.message)
      }
      throw error
    }
    if (!facts || facts.name !== name) {
      return logged('CHAIN_INDEXER_MALFORMED_EVENT', event, 'unexpected event')
    }
    try {
      return await apply(ctx, event, facts)
    } catch (error) {
      if (error instanceof NftStoreConflict) {
        return logged('CHAIN_INDEXER_NFT_CONFLICT', event, error.message)
      }
      throw error
    }
  }
}

const minted = guarded(NFT_MINTED_EVENT, (ctx, event, facts) =>
  facts.name === NFT_MINTED_EVENT
    ? applyMintedEvent(
        ctx,
        { ...eventContext(event.doc), now: event.now },
        facts
      )
    : Promise.resolve('error')
)

const transfer = guarded(NFT_TRANSFER_EVENT, (ctx, event, facts) =>
  facts.name === NFT_TRANSFER_EVENT
    ? applyTransferEvent(
        ctx,
        { ...eventContext(event.doc), now: event.now },
        facts
      )
    : Promise.resolve('error')
)

/** Stored for the record; no table depends on them. */
const recordOnly: ChainEventHandler = async () => 'done'

export const NFT_EVENT_HANDLERS: Readonly<Record<string, ChainEventHandler>> = {
  'nft:article_nft_minted': minted,
  'nft:transfer': transfer,
  // The OpenZeppelin `mint` event repeats what `article_nft_minted` carries.
  'nft:mint': recordOnly,
  'nft:set_token_royalty': recordOnly,
  'nft:approve': recordOnly,
  'nft:approve_for_all': recordOnly,
  'nft:threshold_set': recordOnly,
  'nft:nft_migrated': recordOnly,
  'nft:paused': recordOnly,
  'nft:unpaused': recordOnly,
  'nft:role_granted': recordOnly,
  'nft:role_revoked': recordOnly,
  'nft:role_admin_changed': recordOnly,
  'nft:admin_transfer_initiated': recordOnly,
  'nft:admin_transfer_completed': recordOnly,
}
