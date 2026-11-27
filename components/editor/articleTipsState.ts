/**
 * The author-facing state of an article's tips on Stellar, derived from
 * `chain.articles.getRegistration`. Pure, so every state has a fixture.
 */
import type { FunctionReturnType } from 'convex/server'
import type { api } from '@/convex/_generated/api'

export type Registration = NonNullable<
  FunctionReturnType<typeof api.chain.articles.getRegistration>
>

export type ArticleTipsView =
  | { kind: 'hidden' }
  | { kind: 'loading' }
  | { kind: 'no_wallet' }
  | { kind: 'unverified' }
  | { kind: 'not_registered'; retry: boolean }
  | {
      kind: 'pending'
      action: PendingAction
      /**
       * `prepared`: the request exists, but no signed transaction is
       * recorded yet. `submitted`: the signed transaction was sent.
       */
      stage: 'prepared' | 'submitted'
      txHash: string | null
    }
  | { kind: 'review'; txHash: string | null }
  | {
      kind: 'registered'
      authorAddress: string
      contentVersion: number
      splits: Array<{ recipient: string; bps: number }>
      txHash: string | null
      /** The article's content changed since it was anchored. */
      contentOutdated: boolean
      /** Tips pay an address that is no longer the author's wallet. */
      move: 'none' | 'propose' | 'accept'
      /** The latest update or move attempt failed or expired. */
      lastFailed: boolean
    }

export type PendingAction =
  | 'register'
  | 'content_update'
  | 'author_propose'
  | 'author_accept'

const OPEN = ['PREPARED', 'SUBMITTED']

export function articleTipsView(
  registration: Registration | null | undefined
): ArticleTipsView {
  if (registration === undefined) return { kind: 'loading' }
  if (!registration || !registration.v2Enabled || !registration.published) {
    return { kind: 'hidden' }
  }
  const { wallet, submission, registration: row } = registration
  if (submission && OPEN.includes(submission.status)) {
    return {
      kind: 'pending',
      action: submission.kind as PendingAction,
      stage: submission.status === 'SUBMITTED' ? 'submitted' : 'prepared',
      txHash: submission.txHash,
    }
  }
  if (submission?.needsReview && row?.status !== 'REGISTERED') {
    return { kind: 'review', txHash: submission.txHash }
  }
  if (row?.status === 'REGISTERED') {
    return {
      kind: 'registered',
      authorAddress: row.authorAddress,
      contentVersion: row.contentVersion,
      splits: row.splits,
      txHash: row.txHash,
      contentOutdated: registration.contentOutdated,
      move: registration.canAccept
        ? 'accept'
        : registration.payoutOutdated
          ? 'propose'
          : 'none',
      lastFailed:
        !!submission && submission.kind !== 'register' && submission.canRetry,
    }
  }
  if (wallet.state === 'none') return { kind: 'no_wallet' }
  if (wallet.state === 'unverified') return { kind: 'unverified' }
  return {
    kind: 'not_registered',
    retry: !!submission && submission.canRetry,
  }
}

/** `GABC…WXYZ`, for addresses in running text. */
export function shortAddress(address: string): string {
  return `${address.slice(0, 4)}…${address.slice(-4)}`
}
