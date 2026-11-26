/**
 * The v2 article NFT flow as pure functions, so it can be tested without a
 * browser, Convex or a wallet:
 *
 * - `deriveNftPanel` decides what the panel shows from server data only:
 *   reader progress (`nftsV2.getMintProgress`), the author's live
 *   eligibility (`nftsV2.getMintEligibility`), the article's NFT row
 *   (`nfts.getNFTByArticle`) and the viewer's verified wallet. Ownership and
 *   "minted" come only from indexed rows, which only verified chain events
 *   write.
 * - `nftFlowReducer` runs one mint or transfer: prepare, review (transfer),
 *   the client steps, then tracking the server record until it is final.
 *
 * No value import from the Stellar SDK or the wallet kit (scripts/perf).
 */
import type { NftRunResult } from '@/lib/stellar/v2/nft-actions'
import type { PreparedNftCall } from '@/lib/stellar/v2/nft-calls'
import {
  failureFromContract,
  failureFromWalletError,
  gateFromWalletError,
  noticeFromContractFailure,
  type PaymentFailure,
} from '@/lib/payments/failures'
import type { ClientStep, WalletGateState } from '@/lib/payments/ui-state'
import {
  CHECK_FAILED_TITLE,
  PREPARE_REFUSALS,
  PREPARE_REFUSAL_FALLBACK,
  type NftCopy,
} from '@/lib/copy/nft-v2'

export type NftAction = 'mint' | 'transfer'

// ---------------------------------------------------------------------------
// Server data, structurally (convex/nftsV2.ts, convex/nfts.ts)
// ---------------------------------------------------------------------------

export type MintProgressLike = {
  state: 'DISABLED' | 'NOT_FOUND' | 'NOT_REGISTERED' | 'MINTED' | 'NOT_MINTED'
  thresholdToken: string | null
  threshold: string | null
  total: string | null
  remaining: string | null
  reached: boolean | null
  paused: boolean | null
  tokenId: number | null
  nftId: string | null
  ownerAddress: string | null
}

export type MintEligibilityLike = {
  state: string
  threshold: string | null
  total: string | null
  remaining: string | null
  onChainAuthor: string | null
  callerAddress: string | null
  paused: boolean | null
  tokenId: number | null
  nftId: string | null
  ownerAddress: string | null
  openSubmissionId: string | null
  retryAfterMs: number | null
}

/** The fields of `nfts.getNFTByArticle` the panel reads. */
export type NftRecordLike =
  | {
      isMinted: true
      _id: string
      contractVersion?: 'v1' | 'v2' | string
      recordLabel?: string | null
      tokenId?: string | number
      contractAddress?: string | null
      ownerAddress?: string | null
      txHash?: string | null
      mintedAt?: string | number
      ownerInfo?: {
        id: string
        username?: string | null
        name?: string | null
      } | null
    }
  | { isMinted: false }
  | null

export type NftSubmissionStatusLike = {
  submissionId: string
  action: NftAction
  status: string
  txHash: string | null
  maxTime: number
  mismatchReason: string | null
  needsReview: boolean
  canRetry: boolean
  indexed: boolean
  nft: {
    nftId: string
    tokenId: number
    ownerAddress: string | null
    contractId: string | null
  } | null
}

export type ViewerLike = {
  signedIn: boolean
  /** The article's author in QuillTip. */
  isArticleAuthor: boolean
  /** The account's verified Stellar address, when verified. */
  verifiedAddress: string | null
}

// ---------------------------------------------------------------------------
// Panel
// ---------------------------------------------------------------------------

export type NftPanel =
  | { kind: 'loading' }
  /** v2 is off: the v1 panel renders instead. */
  | { kind: 'v1' }
  | { kind: 'hidden' }
  | {
      kind: 'not-registered'
      v1Record: V1Record | null
      audience: 'reader' | 'author'
    }
  | {
      kind: 'progress'
      v1Record: V1Record | null
      progress: ProgressFigures | null
      mint: MintArea
    }
  | {
      kind: 'minted'
      v1Record: V1Record | null
      token: MintedToken
      /** The viewer's verified wallet owns the token. */
      viewerOwns: boolean
      /** The row is newer than the record the client acted on. */
      transfer: 'allowed' | 'paused' | 'not-owner' | 'signed-out'
    }

export type V1Record = { label: string; mintedAt: string | number | null }

export type ProgressFigures = {
  total: string
  threshold: string
  remaining: string
  reached: boolean
  /** Figures from the author's live read rather than the indexed cache. */
  live: boolean
}

export type MintArea =
  /** Reader, or an author whose live read is not needed. */
  | { kind: 'none' }
  | { kind: 'checking' }
  | { kind: 'eligible' }
  | { kind: 'below' }
  | { kind: 'pending'; submissionId: string | null }
  | { kind: 'message'; state: string }
  | { kind: 'retry-later'; retryAfterMs: number | null }

export type MintedToken = {
  tokenId: number
  nftId: string | null
  ownerAddress: string | null
  ownerUsername: string | null
  contractId: string | null
  txHash: string | null
}

const V1_LABEL = 'v1 record'

function v1RecordOf(record: NftRecordLike | undefined): V1Record | null {
  if (!record || !record.isMinted) return null
  if (record.contractVersion === 'v2') return null
  return {
    label: record.recordLabel || V1_LABEL,
    mintedAt: record.mintedAt ?? null,
  }
}

function isPositiveBase(value: string | null): value is string {
  return value !== null && /^\d+$/.test(value) && BigInt(value) > BigInt(0)
}

function figures(
  source: {
    threshold: string | null
    total: string | null
    remaining: string | null
  },
  live: boolean
): ProgressFigures | null {
  const { threshold, total } = source
  if (!isPositiveBase(threshold) || total === null || !/^\d+$/.test(total)) {
    return null
  }
  const gap = BigInt(threshold) - BigInt(total)
  return {
    total,
    threshold,
    remaining: (gap > BigInt(0) ? gap : BigInt(0)).toString(),
    reached: gap <= BigInt(0),
    live,
  }
}

const ELIGIBILITY_MESSAGES = new Set([
  'NO_WALLET',
  'WALLET_NOT_VERIFIED',
  'AUTHOR_ADDRESS_MISMATCH',
  'PAUSED',
])

/**
 * What the panel shows. `eligibility` is `undefined` while the author's live
 * read runs and `null` when the viewer is not the author (readers never
 * cause a live read).
 */
export function deriveNftPanel(input: {
  v2Enabled: boolean | undefined
  progress: MintProgressLike | undefined
  record: NftRecordLike | undefined
  viewer: ViewerLike | undefined
  eligibility: MintEligibilityLike | null | undefined
}): NftPanel {
  if (input.v2Enabled === undefined) return { kind: 'loading' }
  if (!input.v2Enabled) return { kind: 'v1' }
  const { progress, viewer } = input
  if (!progress || !viewer || input.record === undefined) {
    return { kind: 'loading' }
  }
  const v1Record = v1RecordOf(input.record)
  if (progress.state === 'DISABLED') return { kind: 'v1' }
  if (progress.state === 'NOT_FOUND') return { kind: 'hidden' }

  // Minted: indexed rows only. The live read can know of a mint before the
  // indexer does; the panel then says the owner is updating, without one.
  if (progress.state === 'MINTED' && progress.tokenId !== null) {
    const row =
      input.record &&
      input.record.isMinted &&
      input.record.contractVersion === 'v2'
        ? input.record
        : null
    const ownerAddress = progress.ownerAddress
    const viewerOwns =
      !!viewer.verifiedAddress && viewer.verifiedAddress === ownerAddress
    const ownerUsername =
      row && row.ownerAddress === ownerAddress
        ? (row.ownerInfo?.username ?? null)
        : null
    return {
      kind: 'minted',
      v1Record,
      viewerOwns,
      transfer: !viewer.signedIn
        ? 'signed-out'
        : !viewerOwns
          ? 'not-owner'
          : progress.paused === true
            ? 'paused'
            : 'allowed',
      token: {
        tokenId: progress.tokenId,
        nftId: progress.nftId,
        ownerAddress,
        ownerUsername,
        contractId: row?.contractAddress ?? null,
        txHash: row?.txHash ?? null,
      },
    }
  }

  if (progress.state === 'NOT_REGISTERED') {
    return {
      kind: 'not-registered',
      v1Record,
      audience: viewer.isArticleAuthor ? 'author' : 'reader',
    }
  }

  // NOT_MINTED. Readers see the indexed figures; the author's live read
  // replaces them and decides the action.
  const e = input.eligibility
  if (!viewer.isArticleAuthor || e === null) {
    return {
      kind: 'progress',
      v1Record,
      progress: figures(progress, false),
      mint: { kind: 'none' },
    }
  }
  if (e === undefined) {
    return {
      kind: 'progress',
      v1Record,
      progress: figures(progress, false),
      mint: { kind: 'checking' },
    }
  }
  const live = figures(e, true) ?? figures(progress, false)
  let mint: MintArea
  switch (e.state) {
    case 'ELIGIBLE':
      mint = { kind: 'eligible' }
      break
    case 'BELOW_THRESHOLD':
      mint = { kind: 'below' }
      break
    case 'PENDING':
      mint = { kind: 'pending', submissionId: e.openSubmissionId }
      break
    case 'RATE_LIMITED':
      mint = { kind: 'retry-later', retryAfterMs: e.retryAfterMs }
      break
    case 'UNAVAILABLE':
      mint = { kind: 'retry-later', retryAfterMs: null }
      break
    case 'MINTED':
      // On chain, not yet indexed: no owner is shown until the row exists.
      mint = { kind: 'pending', submissionId: e.openSubmissionId }
      break
    case 'NOT_REGISTERED':
      return { kind: 'not-registered', v1Record, audience: 'author' }
    default:
      mint = ELIGIBILITY_MESSAGES.has(e.state)
        ? { kind: 'message', state: e.state }
        : { kind: 'none' }
  }
  return { kind: 'progress', v1Record, progress: live, mint }
}

// ---------------------------------------------------------------------------
// Running one action
// ---------------------------------------------------------------------------

export type NftFlowStep = ClientStep | 'connecting' | 'recording'

export type NftFlowState =
  | { kind: 'idle' }
  | { kind: 'preparing'; action: NftAction }
  /** Prepare refused (a `ConvexError` code). Nothing was created or sent. */
  | { kind: 'refused'; action: NftAction; code: string; copy: NftCopy }
  /** Transfer only: the server's recipient, waiting for the user to confirm. */
  | { kind: 'review'; prepared: PreparedNftCall; refreshed: boolean }
  /** The client steps, before the record leaves `PREPARED`. */
  | {
      kind: 'running'
      action: NftAction
      submissionId: string
      step: NftFlowStep
    }
  /** Following the server record (`getNftSubmissionStatus`). */
  | {
      kind: 'tracking'
      action: NftAction
      submissionId: string
      txHash: string | null
      /** The wallet refused; the record turns `FAILED` once recorded. */
      declined: boolean
      /** Copy for a `failed` phase this client saw. */
      failure: PaymentFailure | null
      /** Picked up from a reload or another tab, not started here. */
      resumed: boolean
    }
  /** A wallet problem the gate explains. Nothing was signed. */
  | { kind: 'gate'; action: NftAction; gate: WalletGateState }
  /** A standing condition the contract reported. Nothing was signed. */
  | {
      kind: 'notice'
      action: NftAction
      notice: 'paused' | 'insufficient-balance'
    }

export type NftFlowEvent =
  | { type: 'start'; action: NftAction }
  | { type: 'prepared'; prepared: PreparedNftCall; refreshed?: boolean }
  | {
      type: 'prepare-failed'
      action: NftAction
      code: string
      /** `PENDING` carries the open submission. */
      submissionId?: string | null
      message?: string
    }
  | { type: 'confirm' }
  | { type: 'step'; step: NftFlowStep }
  | { type: 'result'; result: NftRunResult }
  | { type: 'resume'; action: NftAction; submissionId: string }
  | { type: 'dismiss' }

export const NFT_FLOW_IDLE: NftFlowState = { kind: 'idle' }

/** Copy for a prepare refusal. */
export function prepareRefusal(code: string): NftCopy {
  return PREPARE_REFUSALS[code] ?? PREPARE_REFUSAL_FALLBACK
}

function actionOf(state: NftFlowState): NftAction | null {
  switch (state.kind) {
    case 'idle':
      return null
    case 'review':
      return state.prepared.action
    default:
      return state.action
  }
}

function submissionOf(state: NftFlowState): string | null {
  if (state.kind === 'review') return state.prepared.submissionId
  if (state.kind === 'running' || state.kind === 'tracking') {
    return state.submissionId
  }
  return null
}

export function nftFlowReducer(
  state: NftFlowState,
  event: NftFlowEvent
): NftFlowState {
  switch (event.type) {
    case 'start':
      // One action at a time; a new start replaces only a finished view.
      if (state.kind === 'preparing' || state.kind === 'running') return state
      return { kind: 'preparing', action: event.action }

    case 'prepared':
      if (state.kind !== 'preparing' && state.kind !== 'review') return state
      if (event.prepared.action === 'transfer') {
        return {
          kind: 'review',
          prepared: event.prepared,
          refreshed: event.refreshed === true,
        }
      }
      return {
        kind: 'running',
        action: 'mint',
        submissionId: event.prepared.submissionId,
        step: 'connecting',
      }

    case 'prepare-failed':
      if (event.code === 'PENDING' && event.submissionId) {
        return {
          kind: 'tracking',
          action: event.action,
          submissionId: event.submissionId,
          txHash: null,
          declined: false,
          failure: null,
          resumed: true,
        }
      }
      if (event.code === 'UNAUTHENTICATED') {
        return {
          kind: 'gate',
          action: event.action,
          gate: { kind: 'signed-out' },
        }
      }
      return {
        kind: 'refused',
        action: event.action,
        code: event.code,
        copy: prepareRefusal(event.code),
      }

    case 'confirm':
      if (state.kind !== 'review') return state
      return {
        kind: 'running',
        action: 'transfer',
        submissionId: state.prepared.submissionId,
        step: 'connecting',
      }

    case 'step':
      if (state.kind !== 'running') return state
      return { ...state, step: event.step }

    case 'result': {
      const action = actionOf(state)
      const submissionId = submissionOf(state)
      if (!action || !submissionId) return state
      return afterResult(action, submissionId, event.result)
    }

    case 'resume':
      // A live action wins over a stored submission.
      if (state.kind === 'running' || state.kind === 'review') return state
      if (
        state.kind === 'tracking' &&
        state.submissionId === event.submissionId
      ) {
        return state
      }
      return {
        kind: 'tracking',
        action: event.action,
        submissionId: event.submissionId,
        txHash: null,
        declined: false,
        failure: null,
        resumed: true,
      }

    case 'dismiss':
      if (state.kind === 'running' || state.kind === 'preparing') return state
      return NFT_FLOW_IDLE
  }
}

function afterResult(
  action: NftAction,
  submissionId: string,
  result: NftRunResult
): NftFlowState {
  const tracking = (
    extra: Partial<Extract<NftFlowState, { kind: 'tracking' }>> = {}
  ): NftFlowState => ({
    kind: 'tracking',
    action,
    submissionId,
    txHash: null,
    declined: false,
    failure: null,
    resumed: false,
    ...extra,
  })
  switch (result.status) {
    case 'sent':
      return tracking({ txHash: result.hash })
    case 'check_failed':
      return tracking({
        failure: { title: CHECK_FAILED_TITLE, detail: result.message },
      })
    case 'wallet_failed': {
      const { kind } = result.error
      if (kind === 'cancelled') return NFT_FLOW_IDLE
      if (kind === 'rejected') return tracking({ declined: true })
      const gate = gateFromWalletError(result.error)
      if (gate) return { kind: 'gate', action, gate }
      return tracking({ failure: failureFromWalletError(result.error) })
    }
    case 'simulation_failed':
    case 'send_error': {
      const notice = noticeFromContractFailure(result.error)
      if (
        notice?.kind === 'paused' ||
        notice?.kind === 'insufficient-balance'
      ) {
        return { kind: 'notice', action, notice: notice.kind }
      }
      return tracking({ failure: failureFromContract(result.error) })
    }
    case 'not_sent':
      return tracking({
        failure: {
          title: 'Stellar testnet is busy',
          detail:
            'It was not sent, so nothing was paid. Try again in a minute.',
        },
      })
  }
}

/** The client step the progress view shows while the record is `PREPARED`. */
export function progressStep(step: NftFlowStep): ClientStep {
  if (step === 'connecting') return 'simulating'
  if (step === 'recording') return 'sending'
  return step
}

/**
 * True once the server's record is final for the UI: confirmed and
 * indexed, or any end state other than confirmed. A confirmed record whose
 * event is not yet indexed is not final: the owner is still updating.
 */
export function isSettled(status: NftSubmissionStatusLike): boolean {
  if (status.status === 'CONFIRMED') return status.indexed
  return ['MISMATCH', 'FAILED', 'EXPIRED'].includes(status.status)
}

/** The server allows a new request: `canRetry` from the record. */
export function canRetry(status: NftSubmissionStatusLike | null): boolean {
  return !!status && status.canRetry && !status.needsReview
}

/** "Slow" once the server has no answer past `maxTime + 30 s`. */
export function isSlow(
  status: NftSubmissionStatusLike | null,
  now: number
): boolean {
  return (
    !!status &&
    (status.status === 'SUBMITTED' || status.status === 'PREPARED') &&
    now > (status.maxTime + 30) * 1000
  )
}

// ---------------------------------------------------------------------------
// Resume after a reload
// ---------------------------------------------------------------------------

const STORAGE_PREFIX = 'qt:nft-v2:'

export function resumeKey(action: NftAction, id: string): string {
  return `${STORAGE_PREFIX}${action}:${id}`
}

/**
 * Remembers the submission an action created, so a reload resumes from the
 * server record. Only the ID is stored; the state always comes from the
 * server, which returns nothing for another user's submission.
 */
export const resumeStore = {
  read(key: string): string | null {
    try {
      const value = window.localStorage.getItem(key)
      return value && /^[A-Za-z0-9_-]{1,64}$/.test(value) ? value : null
    } catch {
      return null
    }
  },
  write(key: string, submissionId: string): void {
    try {
      window.localStorage.setItem(key, submissionId)
    } catch {
      // Private mode or blocked storage: the reload falls back to the
      // server's open submission (mint) or the PENDING refusal (transfer).
    }
  },
  clear(key: string): void {
    try {
      window.localStorage.removeItem(key)
    } catch {
      // Nothing to clear.
    }
  },
}
