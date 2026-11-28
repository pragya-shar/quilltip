/**
 * The v2 article NFT flow state machine (lib/nft/v2-flow.ts): which panel
 * the server data selects, and how one mint or transfer moves through
 * prepare, review, the client steps and the server record.
 */
import { describe, expect, it } from 'vitest'
import {
  NFT_FLOW_IDLE,
  canRetry,
  deriveNftPanel,
  nftClientConfigured,
  isSettled,
  isSlow,
  nftFlowReducer,
  progressStep,
  type MintEligibilityLike,
  type MintProgressLike,
  type NftFlowEvent,
  type NftFlowState,
  type NftRecordLike,
  type NftSubmissionStatusLike,
} from '../../lib/nft/v2-flow'
import type {
  PreparedNftMint,
  PreparedNftTransfer,
} from '../../lib/stellar/v2/nft-calls'
import { WalletError } from '../../lib/stellar/v2/wallet-errors'
import { PREPARE_REFUSALS } from '../../lib/copy/nft-v2'
import { NFT_PREPARE_ERROR_CODES } from '../../convex/lib/chain/nftEvents'
import { MINT_ELIGIBILITY_STATES } from '../../convex/nftsV2'

const OWNER = 'GBZXN7PIRZGNMHGA7MUUUF4GWPY5AYPV6LY4UV2GL6VJGIQRXFDNMADI'
const READER = 'GCS5XCIKIBZ3L5CUKJMMAG6IUBBNCCPT5SFTXFW5I4DZOMT4RJ43DUAR'
const THRESHOLD = '500000000'

function progress(extra: Partial<MintProgressLike> = {}): MintProgressLike {
  return {
    state: 'NOT_MINTED',
    thresholdToken: 'CDLZ',
    threshold: THRESHOLD,
    total: '125000000',
    remaining: '375000000',
    reached: false,
    paused: false,
    tokenId: null,
    nftId: null,
    ownerAddress: null,
    ...extra,
  }
}

function eligibility(
  state: string,
  extra: Partial<MintEligibilityLike> = {}
): MintEligibilityLike {
  return {
    state,
    threshold: THRESHOLD,
    total: '500000000',
    remaining: '0',
    onChainAuthor: OWNER,
    callerAddress: OWNER,
    paused: false,
    tokenId: null,
    nftId: null,
    ownerAddress: null,
    openSubmissionId: null,
    retryAfterMs: null,
    ...extra,
  }
}

const minted = progress({
  state: 'MINTED',
  tokenId: 3,
  nftId: 'nft-3',
  ownerAddress: OWNER,
})
const v2Row: NftRecordLike = {
  isMinted: true,
  _id: 'nft-3',
  contractVersion: 'v2',
  tokenId: '3',
  contractAddress: 'CCOJ',
  ownerAddress: OWNER,
  txHash: 'ab'.repeat(32),
  ownerInfo: { id: 'u-writer', username: 'writer' },
}
const v1Row: NftRecordLike = {
  isMinted: true,
  _id: 'nft-v1',
  contractVersion: 'v1',
  recordLabel: 'v1 record',
  mintedAt: '2025-01-01T00:00:00.000Z',
}

const reader = {
  signedIn: false,
  isArticleAuthor: false,
  verifiedAddress: null,
}
const author = { signedIn: true, isArticleAuthor: true, verifiedAddress: OWNER }

describe('deriveNftPanel', () => {
  it('waits for the config, the progress, the row and the viewer', () => {
    expect(
      deriveNftPanel({
        v2Enabled: undefined,
        progress: undefined,
        record: undefined,
        viewer: undefined,
        eligibility: null,
      })
    ).toEqual({ kind: 'loading' })
    expect(
      deriveNftPanel({
        v2Enabled: true,
        progress: progress(),
        record: undefined,
        viewer: reader,
        eligibility: null,
      })
    ).toEqual({ kind: 'loading' })
  })

  it('is unavailable when v2 is off or no NFT contract is set', () => {
    expect(
      deriveNftPanel({
        v2Enabled: false,
        progress: undefined,
        record: v1Row,
        viewer: reader,
        eligibility: null,
      })
    ).toEqual({ kind: 'unavailable' })
    expect(
      deriveNftPanel({
        v2Enabled: true,
        progress: progress({ state: 'DISABLED' }),
        record: null,
        viewer: reader,
        eligibility: null,
      })
    ).toEqual({ kind: 'unavailable' })
  })

  it('shows readers the indexed progress and no action', () => {
    const panel = deriveNftPanel({
      v2Enabled: true,
      progress: progress(),
      record: { isMinted: false },
      viewer: reader,
      eligibility: null,
    })
    expect(panel).toEqual({
      kind: 'progress',
      v1Record: null,
      progress: {
        total: '125000000',
        threshold: THRESHOLD,
        remaining: '375000000',
        reached: false,
        live: false,
      },
      mint: { kind: 'none' },
    })
  })

  it('shows no figures while the threshold is unknown', () => {
    const panel = deriveNftPanel({
      v2Enabled: true,
      progress: progress({ threshold: null, total: null, remaining: null }),
      record: null,
      viewer: reader,
      eligibility: null,
    })
    expect(panel).toMatchObject({ kind: 'progress', progress: null })
  })

  it('needs the client NFT contract, and the server one to match when it has one (#547)', () => {
    const NFT = 'CCOJOXITZQM7R6FSFPICN4Y3GONM4TN4Y6QV64CARDHNNRUT3U5SCYT7'
    const OTHER = 'CAFCGOIM6SKVBWCPFQODN22MY5HUJEJMW5AOMNGAOVZ4QBLJJ5RLOOMS'
    // Neither side has one: nothing can be checked or signed here.
    expect(nftClientConfigured(null, null)).toBe(false)
    expect(nftClientConfigured(undefined, undefined)).toBe(false)
    expect(nftClientConfigured('', null)).toBe(false)
    // Only the server has one.
    expect(nftClientConfigured(null, NFT)).toBe(false)
    // Only the client has one: the server does not report it yet.
    expect(nftClientConfigured(NFT, null)).toBe(true)
    // Both, the same or different.
    expect(nftClientConfigured(NFT, NFT)).toBe(true)
    expect(nftClientConfigured(NFT, OTHER)).toBe(false)
  })

  it('says minting and transfers are not available without the client NFT contract (#547)', () => {
    expect(
      deriveNftPanel({
        v2Enabled: true,
        progress: progress(),
        record: null,
        viewer: author,
        eligibility: eligibility('ELIGIBLE'),
        clientConfigured: false,
      })
    ).toMatchObject({ kind: 'progress', mint: { kind: 'not-configured' } })
    expect(
      deriveNftPanel({
        v2Enabled: true,
        progress: minted,
        record: v2Row,
        viewer: author,
        eligibility: null,
        clientConfigured: false,
      })
    ).toMatchObject({ kind: 'minted', transfer: 'not-configured' })
  })

  it('keeps a v1 record labelled beside the v2 progress', () => {
    const panel = deriveNftPanel({
      v2Enabled: true,
      progress: progress(),
      record: v1Row,
      viewer: author,
      eligibility: eligibility('ELIGIBLE'),
    })
    expect(panel).toMatchObject({
      kind: 'progress',
      v1Record: { label: 'v1 record' },
      mint: { kind: 'eligible' },
    })
  })

  it('uses the live figures for the author and shows the action only when eligible', () => {
    const at = deriveNftPanel({
      v2Enabled: true,
      progress: progress(),
      record: null,
      viewer: author,
      eligibility: eligibility('ELIGIBLE'),
    })
    expect(at).toMatchObject({
      kind: 'progress',
      progress: { total: '500000000', reached: true, live: true },
      mint: { kind: 'eligible' },
    })
    for (const [state, kind] of [
      ['BELOW_THRESHOLD', 'below'],
      ['PENDING', 'pending'],
      ['RATE_LIMITED', 'retry-later'],
      ['UNAVAILABLE', 'retry-later'],
      ['NO_WALLET', 'message'],
      ['WALLET_NOT_VERIFIED', 'message'],
      ['AUTHOR_ADDRESS_MISMATCH', 'message'],
      ['PAUSED', 'message'],
      ['MINTED', 'indexing'],
      ['NOT_AUTHOR', 'none'],
      ['SIGNED_OUT', 'none'],
    ] as const) {
      const panel = deriveNftPanel({
        v2Enabled: true,
        progress: progress(),
        record: null,
        viewer: author,
        eligibility: eligibility(state),
      })
      expect(panel, state).toMatchObject({ mint: { kind } })
    }
  })

  it('maps every eligibility state the server returns', () => {
    for (const state of MINT_ELIGIBILITY_STATES) {
      const panel = deriveNftPanel({
        v2Enabled: true,
        progress: progress(),
        record: null,
        viewer: author,
        eligibility: eligibility(state),
      })
      expect(['progress', 'not-registered']).toContain(panel.kind)
      if (state !== 'ELIGIBLE') {
        expect(panel).not.toMatchObject({ mint: { kind: 'eligible' } })
      }
    }
  })

  it('shows checking while the author read runs', () => {
    expect(
      deriveNftPanel({
        v2Enabled: true,
        progress: progress(),
        record: null,
        viewer: author,
        eligibility: undefined,
      })
    ).toMatchObject({ mint: { kind: 'checking' } })
  })

  it('never shows the owner of a mint the indexer has not applied', () => {
    const panel = deriveNftPanel({
      v2Enabled: true,
      progress: progress({ reached: true }),
      record: null,
      viewer: author,
      eligibility: eligibility('MINTED', { tokenId: 3 }),
    })
    expect(panel).toMatchObject({
      kind: 'progress',
      mint: { kind: 'indexing' },
    })
    expect(JSON.stringify(panel)).not.toContain(OWNER)
    // With a submission still open here, the panel follows that record.
    expect(
      deriveNftPanel({
        v2Enabled: true,
        progress: progress({ reached: true }),
        record: null,
        viewer: author,
        eligibility: eligibility('MINTED', {
          tokenId: 3,
          openSubmissionId: 'open-1',
        }),
      })
    ).toMatchObject({ mint: { kind: 'pending', submissionId: 'open-1' } })
  })

  it('shows the minted token and lets only the owner transfer', () => {
    const owner = deriveNftPanel({
      v2Enabled: true,
      progress: minted,
      record: v2Row,
      viewer: author,
      eligibility: null,
    })
    expect(owner).toEqual({
      kind: 'minted',
      v1Record: null,
      viewerOwns: true,
      transfer: 'allowed',
      token: {
        tokenId: 3,
        nftId: 'nft-3',
        ownerAddress: OWNER,
        ownerUsername: 'writer',
        contractId: 'CCOJ',
        txHash: 'ab'.repeat(32),
      },
    })
    const other = deriveNftPanel({
      v2Enabled: true,
      progress: minted,
      record: v2Row,
      viewer: {
        signedIn: true,
        isArticleAuthor: false,
        verifiedAddress: READER,
      },
      eligibility: null,
    })
    expect(other).toMatchObject({ viewerOwns: false, transfer: 'not-owner' })
    expect(
      deriveNftPanel({
        v2Enabled: true,
        progress: minted,
        record: v2Row,
        viewer: reader,
        eligibility: null,
      })
    ).toMatchObject({ transfer: 'signed-out' })
    expect(
      deriveNftPanel({
        v2Enabled: true,
        progress: { ...minted, paused: true },
        record: v2Row,
        viewer: author,
        eligibility: null,
      })
    ).toMatchObject({ transfer: 'paused' })
  })

  it('follows an outside transfer: the former owner loses the action', () => {
    const moved = { ...minted, ownerAddress: READER }
    const formerOwner = deriveNftPanel({
      v2Enabled: true,
      progress: moved,
      // The row's cached owner info is stale; it is not shown.
      record: v2Row,
      viewer: author,
      eligibility: null,
    })
    expect(formerOwner).toMatchObject({
      viewerOwns: false,
      transfer: 'not-owner',
      token: { ownerAddress: READER, ownerUsername: null },
    })
    const newOwner = deriveNftPanel({
      v2Enabled: true,
      progress: moved,
      record: { ...v2Row, ownerAddress: READER, ownerInfo: null },
      viewer: {
        signedIn: true,
        isArticleAuthor: false,
        verifiedAddress: READER,
      },
      eligibility: null,
    })
    expect(newOwner).toMatchObject({ viewerOwns: true, transfer: 'allowed' })
  })

  it('distinguishes readers and authors before registration', () => {
    expect(
      deriveNftPanel({
        v2Enabled: true,
        progress: progress({ state: 'NOT_REGISTERED' }),
        record: null,
        viewer: author,
        eligibility: null,
      })
    ).toEqual({ kind: 'not-registered', v1Record: null, audience: 'author' })
    expect(
      deriveNftPanel({
        v2Enabled: true,
        progress: progress({ state: 'NOT_FOUND' }),
        record: null,
        viewer: reader,
        eligibility: null,
      })
    ).toEqual({ kind: 'hidden' })
  })
})

// ---------------------------------------------------------------------------

const preparedMint: PreparedNftMint = {
  submissionId: 'sub-m',
  existing: false,
  network: 'TESTNET',
  networkPassphrase: 'Test SDF Network ; September 2015',
  contractId: 'CCOJ',
  maxTime: 2_000_000_000,
  signer: OWNER,
  action: 'mint',
  method: 'mint',
  args: { article_id: 'ab'.repeat(32) },
  articleId: 'a1',
  articleKey: 'ab'.repeat(32),
}
const preparedTransfer: PreparedNftTransfer = {
  submissionId: 'sub-t',
  existing: false,
  network: 'TESTNET',
  networkPassphrase: 'Test SDF Network ; September 2015',
  contractId: 'CCOJ',
  maxTime: 2_000_000_000,
  signer: OWNER,
  action: 'transfer',
  method: 'transfer',
  args: { from: OWNER, to: READER, token_id: 3 },
  nftId: 'nft-3',
  tokenId: 3,
  recipient: { address: READER, userId: null, username: null },
}

function run(events: NftFlowEvent[], from = NFT_FLOW_IDLE): NftFlowState {
  return events.reduce(nftFlowReducer, from)
}

describe('nftFlowReducer', () => {
  it('runs a mint: prepare, steps, then follows the record', () => {
    const states: NftFlowState[] = []
    let s = NFT_FLOW_IDLE
    for (const event of [
      { type: 'start', action: 'mint' },
      { type: 'prepared', prepared: preparedMint },
      { type: 'step', step: 'simulating' },
      { type: 'step', step: 'signing' },
      { type: 'step', step: 'sending' },
      { type: 'result', result: { status: 'sent', hash: 'h1' } },
    ] as NftFlowEvent[]) {
      s = nftFlowReducer(s, event)
      states.push(s)
    }
    expect(states.map((x) => x.kind)).toEqual([
      'preparing',
      'running',
      'running',
      'running',
      'running',
      'tracking',
    ])
    expect(s).toEqual({
      kind: 'tracking',
      action: 'mint',
      submissionId: 'sub-m',
      txHash: 'h1',
      declined: false,
      failure: null,
      resumed: false,
    })
  })

  it('stops a transfer at review until the user confirms', () => {
    const review = run([
      { type: 'start', action: 'transfer' },
      { type: 'prepared', prepared: preparedTransfer },
    ])
    expect(review).toEqual({
      kind: 'review',
      prepared: preparedTransfer,
      refreshed: false,
    })
    // A step event cannot skip the confirmation.
    expect(nftFlowReducer(review, { type: 'step', step: 'signing' })).toBe(
      review
    )
    expect(nftFlowReducer(review, { type: 'confirm' })).toMatchObject({
      kind: 'running',
      action: 'transfer',
      submissionId: 'sub-t',
    })
    expect(nftFlowReducer(review, { type: 'dismiss' })).toEqual(NFT_FLOW_IDLE)
  })

  it('marks a review prepared again after a timeout', () => {
    expect(
      run([
        { type: 'start', action: 'transfer' },
        { type: 'prepared', prepared: preparedTransfer, refreshed: true },
      ])
    ).toMatchObject({ kind: 'review', refreshed: true })
  })

  it('runs one action at a time', () => {
    const running = run([
      { type: 'start', action: 'mint' },
      { type: 'prepared', prepared: preparedMint },
    ])
    expect(nftFlowReducer(running, { type: 'start', action: 'mint' })).toBe(
      running
    )
    expect(nftFlowReducer(running, { type: 'dismiss' })).toBe(running)
    expect(
      nftFlowReducer(running, {
        type: 'resume',
        action: 'mint',
        submissionId: 'other',
      })
    ).toBe(running)
  })

  it('maps prepare refusals to copy, and PENDING to the open record', () => {
    for (const code of NFT_PREPARE_ERROR_CODES) {
      const s = run([
        { type: 'start', action: 'transfer' },
        { type: 'prepare-failed', action: 'transfer', code },
      ])
      if (code === 'UNAUTHENTICATED') {
        expect(s).toMatchObject({ kind: 'gate', gate: { kind: 'signed-out' } })
      } else if (code === 'PENDING') {
        // No submission ID: plain refusal copy.
        expect(s).toMatchObject({ kind: 'refused', code })
      } else if (code === 'PAUSED') {
        // The server's cached pause: the same notice as a paused simulation.
        expect(s).toEqual({
          kind: 'notice',
          action: 'transfer',
          notice: 'paused',
        })
      } else {
        expect(s).toMatchObject({ kind: 'refused', code })
        expect(PREPARE_REFUSALS[code], code).toBeDefined()
      }
    }
    expect(
      run([
        { type: 'start', action: 'mint' },
        {
          type: 'prepare-failed',
          action: 'mint',
          code: 'PENDING',
          submissionId: 'open-1',
        },
      ])
    ).toMatchObject({ kind: 'tracking', submissionId: 'open-1', resumed: true })
    expect(
      run([
        { type: 'start', action: 'mint' },
        { type: 'prepare-failed', action: 'mint', code: 'SOMETHING_NEW' },
      ])
    ).toMatchObject({ kind: 'refused', copy: { title: expect.any(String) } })
  })

  const running = run([
    { type: 'start', action: 'transfer' },
    { type: 'prepared', prepared: preparedTransfer },
    { type: 'confirm' },
  ])

  it('asks a wallet on another account to switch to the linked address (#547)', () => {
    const state = nftFlowReducer(running, {
      type: 'result',
      result: { status: 'wrong_account', expected: OWNER, connected: READER },
    })
    expect(state).toMatchObject({ kind: 'tracking', declined: false })
    const failure = (state as { failure: { title: string; detail: string } })
      .failure
    expect(failure.title).toMatch(/^Switch your wallet to G.+…/)
    expect(failure.detail).toMatch(
      /the address linked to your Quilltip account/
    )
    expect(failure.detail).toMatch(/Nothing was signed\.$/)
    expect(failure.title).not.toMatch(/signed with another account/)
  })

  it('reads a wallet refusal as declined and a closed picker as nothing', () => {
    expect(
      nftFlowReducer(running, {
        type: 'result',
        result: {
          status: 'wallet_failed',
          error: new WalletError('rejected', 'no'),
        },
      })
    ).toMatchObject({ kind: 'tracking', declined: true, failure: null })
    expect(
      nftFlowReducer(running, {
        type: 'result',
        result: {
          status: 'wallet_failed',
          error: new WalletError('cancelled', 'closed'),
        },
      })
    ).toEqual(NFT_FLOW_IDLE)
  })

  it('sends wallet gate problems to the gate', () => {
    for (const [kind, gate] of [
      ['locked', 'locked'],
      ['no-wallet', 'no-wallet'],
      ['wrong-network', 'wrong-network'],
    ] as const) {
      expect(
        nftFlowReducer(running, {
          type: 'result',
          result: {
            status: 'wallet_failed',
            error: new WalletError(kind, kind),
          },
        })
      ).toMatchObject({ kind: 'gate', gate: { kind: gate } })
    }
    expect(
      nftFlowReducer(running, {
        type: 'result',
        result: {
          status: 'wallet_failed',
          error: new WalletError('timeout', 't'),
        },
      })
    ).toMatchObject({
      kind: 'tracking',
      failure: { title: 'Your wallet did not respond' },
    })
  })

  it('shows the paused notice for a paused contract', () => {
    expect(
      nftFlowReducer(running, {
        type: 'result',
        result: {
          status: 'simulation_failed',
          error: {
            code: 1000,
            name: 'EnforcedPause',
            contract: 'nft',
            message: 'paused',
          },
          detail: 'x',
        },
      })
    ).toEqual({ kind: 'notice', action: 'transfer', notice: 'paused' })
  })

  it('shows a decoded contract failure as not sent', () => {
    expect(
      nftFlowReducer(running, {
        type: 'result',
        result: {
          status: 'simulation_failed',
          error: {
            code: 70,
            name: 'BelowThreshold',
            contract: 'nft',
            message:
              'This article has not reached the tip total needed to mint.',
          },
          detail: 'x',
        },
      })
    ).toMatchObject({
      kind: 'tracking',
      failure: {
        title: 'Not sent',
        detail: expect.stringContaining('tip total needed to mint'),
      },
    })
  })

  it('shows a local check failure without sending', () => {
    expect(
      nftFlowReducer(running, {
        type: 'result',
        result: {
          status: 'check_failed',
          check: 'recipient',
          message: 'The recipient does not match.',
        },
      })
    ).toMatchObject({
      kind: 'tracking',
      failure: { detail: 'The recipient does not match.' },
    })
  })

  it('resumes a stored submission, once', () => {
    const resumed = nftFlowReducer(NFT_FLOW_IDLE, {
      type: 'resume',
      action: 'transfer',
      submissionId: 'sub-t',
    })
    expect(resumed).toMatchObject({ kind: 'tracking', resumed: true })
    expect(
      nftFlowReducer(resumed, {
        type: 'resume',
        action: 'transfer',
        submissionId: 'sub-t',
      })
    ).toBe(resumed)
  })
})

function status(
  value: string,
  extra: Partial<NftSubmissionStatusLike> = {}
): NftSubmissionStatusLike {
  return {
    submissionId: 's',
    action: 'mint',
    status: value,
    txHash: 'h',
    maxTime: 1_000,
    mismatchReason: null,
    needsReview: false,
    canRetry: value === 'FAILED' || value === 'EXPIRED',
    indexed: false,
    nft: null,
    ...extra,
  }
}

describe('record helpers', () => {
  it('is settled only when confirmed and indexed, or at another end state', () => {
    expect(isSettled(status('SUBMITTED'))).toBe(false)
    expect(isSettled(status('CONFIRMED'))).toBe(false)
    expect(isSettled(status('CONFIRMED', { indexed: true }))).toBe(true)
    expect(isSettled(status('MISMATCH'))).toBe(true)
    expect(isSettled(status('FAILED'))).toBe(true)
    expect(isSettled(status('EXPIRED'))).toBe(true)
  })

  it('retries only when the server allows it, never after MISMATCH', () => {
    expect(canRetry(status('FAILED'))).toBe(true)
    expect(canRetry(status('EXPIRED'))).toBe(true)
    expect(canRetry(status('FAILED', { needsReview: true }))).toBe(false)
    expect(canRetry(status('MISMATCH', { canRetry: false }))).toBe(false)
    expect(canRetry(status('SUBMITTED'))).toBe(false)
    expect(canRetry(null)).toBe(false)
  })

  it('is slow past maxTime + 30 s with no answer', () => {
    expect(isSlow(status('SUBMITTED'), 1_030_000)).toBe(false)
    expect(isSlow(status('SUBMITTED'), 1_030_001)).toBe(true)
    expect(isSlow(status('CONFIRMED'), 9_999_999)).toBe(false)
  })

  it('maps runner phases to the kit steps', () => {
    expect(progressStep('connecting')).toBe('simulating')
    expect(progressStep('signing')).toBe('signing')
    expect(progressStep('recording')).toBe('sending')
  })
})
