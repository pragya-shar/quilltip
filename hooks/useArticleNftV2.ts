'use client'

import {
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from 'react'
import { useAction, useMutation, useQuery } from 'convex/react'
import { ConvexError } from 'convex/values'
import { api } from '@/convex/_generated/api'
import type { Id } from '@/convex/_generated/dataModel'
import { useWallet } from '@/components/providers/WalletProvider'
import { wallet } from '@/lib/stellar/v2/wallet-kit'
import { v2Runtime } from '@/lib/stellar/v2/chain-runtime'
import { runNftCall } from '@/lib/stellar/v2/nft-actions'
import type {
  PreparedNftCall,
  PreparedNftTransfer,
  RecipientInput,
} from '@/lib/stellar/v2/nft-calls'
import {
  NFT_FLOW_IDLE,
  deriveNftPanel,
  isSettled,
  nftFlowReducer,
  resumeKey,
  resumeStore,
  type MintEligibilityLike,
  type NftAction,
  type NftRecordLike,
  type NftSubmissionStatusLike,
} from '@/lib/nft/v2-flow'

/** Seconds left on a reviewed transfer before it is prepared again. */
const REVIEW_MARGIN_SECONDS = 30

function requestId(): string {
  return crypto.randomUUID()
}

function errorData(error: unknown): {
  code: string
  submissionId?: string
  message?: string
} {
  if (
    error instanceof ConvexError &&
    error.data &&
    typeof error.data === 'object'
  ) {
    const data = error.data as {
      code?: string
      submissionId?: string
      message?: string
    }
    return {
      code: data.code ?? 'SERVER',
      submissionId: data.submissionId,
      message: data.message,
    }
  }
  return { code: 'SERVER' }
}

export type UseArticleNftV2Args = {
  articleId: Id<'articles'>
  authorId: Id<'users'>
  currentUserId?: Id<'users'>
}

/**
 * The v2 article NFT for one article: what to show, and the mint and
 * transfer actions. Server data decides every state; see lib/nft/v2-flow.ts.
 */
export function useArticleNftV2({
  articleId,
  authorId,
  currentUserId,
}: UseArticleNftV2Args) {
  const config = useQuery(api.chain.config.getChainConfig, {})
  const v2 = config?.v2Enabled === true
  const progress = useQuery(
    api.nftsV2.getMintProgress,
    v2 ? { articleId } : 'skip'
  )
  const record = useQuery(api.nfts.getNFTByArticle, v2 ? { articleId } : 'skip')
  const walletLink = useQuery(
    api.walletLink.getMyWalletLink,
    v2 && currentUserId ? {} : 'skip'
  )
  const readEligibility = useAction(api.nftsV2.getMintEligibility)
  const prepareMint = useMutation(api.nftsV2.prepareMint)
  const prepareTransfer = useMutation(api.nftsV2.prepareTransfer)
  const recordSubmitted = useMutation(api.chain.submissions.recordSubmitted)
  const recordSendFailed = useMutation(api.chain.submissions.recordSendFailed)

  const isArticleAuthor = !!currentUserId && currentUserId === authorId
  const signedIn = !!currentUserId
  const verifiedAddress =
    walletLink?.state === 'verified' ? walletLink.address : null
  const viewer = useMemo(
    () =>
      !v2
        ? undefined
        : signedIn && walletLink === undefined
          ? undefined
          : { signedIn, isArticleAuthor, verifiedAddress },
    [v2, signedIn, walletLink, isArticleAuthor, verifiedAddress]
  )

  // The author's live read. Readers never cause one.
  const [eligibility, setEligibility] = useState<
    MintEligibilityLike | null | undefined
  >(undefined)
  const needsLiveRead =
    v2 && isArticleAuthor && progress?.state === 'NOT_MINTED'
  const [eligibilityTick, setEligibilityTick] = useState(0)
  const refreshEligibility = useCallback(
    () => setEligibilityTick((n) => n + 1),
    []
  )
  // A new indexed total or a different viewer wallet asks again.
  const liveKey = `${progress?.total ?? ''}|${verifiedAddress ?? ''}|${eligibilityTick}`
  useEffect(() => {
    if (!needsLiveRead) {
      setEligibility(isArticleAuthor ? undefined : null)
      return
    }
    let cancelled = false
    setEligibility(undefined)
    readEligibility({ articleId })
      .then((result) => {
        if (!cancelled) setEligibility(result as MintEligibilityLike)
      })
      .catch(() => {
        if (!cancelled) {
          setEligibility({
            state: 'UNAVAILABLE',
            threshold: null,
            total: null,
            remaining: null,
            onChainAuthor: null,
            callerAddress: null,
            paused: null,
            tokenId: null,
            nftId: null,
            ownerAddress: null,
            openSubmissionId: null,
            retryAfterMs: null,
          })
        }
      })
    return () => {
      cancelled = true
    }
  }, [needsLiveRead, isArticleAuthor, articleId, readEligibility, liveKey])

  const panel = deriveNftPanel({
    v2Enabled: config === undefined ? undefined : v2,
    progress: progress ?? undefined,
    record: record as NftRecordLike | undefined,
    viewer,
    eligibility: isArticleAuthor ? eligibility : null,
  })

  // --- One action at a time ------------------------------------------------

  const [flow, dispatch] = useReducer(nftFlowReducer, NFT_FLOW_IDLE)
  const flowRef = useRef(flow)
  flowRef.current = flow

  // Load the wallet runtime only when this viewer has an action here.
  const hasAction =
    (panel.kind === 'progress' && panel.mint.kind !== 'none') ||
    (panel.kind === 'minted' && panel.viewerOwns)
  const walletContext = useWallet({ activateOnMount: hasAction })
  const walletRef = useRef(walletContext)
  walletRef.current = walletContext

  const nftId = panel.kind === 'minted' ? panel.token.nftId : null
  const mintKey = resumeKey('mint', articleId)
  const transferKey = nftId ? resumeKey('transfer', nftId) : null

  // Resume after a reload: the stored submission, then the server's open
  // mint. The server returns nothing for a submission that is not ours.
  useEffect(() => {
    if (!v2 || !signedIn) return
    const stored = resumeStore.read(mintKey)
    if (stored)
      dispatch({ type: 'resume', action: 'mint', submissionId: stored })
  }, [v2, signedIn, mintKey])
  useEffect(() => {
    if (!v2 || !signedIn || !transferKey) return
    const stored = resumeStore.read(transferKey)
    if (stored) {
      dispatch({ type: 'resume', action: 'transfer', submissionId: stored })
    }
  }, [v2, signedIn, transferKey])
  const openMint =
    eligibility && eligibility.state === 'PENDING'
      ? eligibility.openSubmissionId
      : null
  useEffect(() => {
    if (openMint) {
      dispatch({ type: 'resume', action: 'mint', submissionId: openMint })
    }
  }, [openMint])

  const trackedId =
    flow.kind === 'running' || flow.kind === 'tracking'
      ? flow.submissionId
      : flow.kind === 'review'
        ? flow.prepared.submissionId
        : null
  const status = useQuery(
    api.nftsV2.getNftSubmissionStatus,
    trackedId ? { submissionId: trackedId as Id<'chainSubmissions'> } : 'skip'
  ) as NftSubmissionStatusLike | null | undefined

  // A stored ID the server does not know (or not ours): forget it.
  useEffect(() => {
    if (status === null && flow.kind === 'tracking' && flow.resumed) {
      resumeStore.clear(flow.action === 'mint' ? mintKey : (transferKey ?? ''))
      dispatch({ type: 'dismiss' })
    }
  }, [status, flow, mintKey, transferKey])

  // A finished mint asks the live read again (minted, or retry allowed).
  const settled = status ? isSettled(status) : false
  useEffect(() => {
    if (settled && isArticleAuthor) refreshEligibility()
  }, [settled, isArticleAuthor, refreshEligibility])

  const keyFor = useCallback(
    (action: NftAction) => (action === 'mint' ? mintKey : transferKey),
    [mintKey, transferKey]
  )

  const submit = useCallback(
    async (prepared: PreparedNftCall, expectedRecipient: string | null) => {
      let runtime
      try {
        runtime = v2Runtime()
      } catch (error) {
        console.error('[nft] payments v2 is not configured', error)
        dispatch({
          type: 'prepare-failed',
          action: prepared.action,
          code: 'CHAIN_CONFIG_MISSING',
        })
        return
      }
      const { config: client } = runtime
      const result = await runNftCall({
        prepared,
        expected:
          prepared.action === 'mint'
            ? {
                action: 'mint',
                articleId,
                networkPassphrase: client.passphrase,
                nftContractId: client.nftContractId,
                platformContracts: [
                  client.coreContractId,
                  client.tabContractId,
                  client.tokenContractId,
                ],
              }
            : {
                action: 'transfer',
                nftId: nftId ?? '',
                tokenId:
                  panel.kind === 'minted' ? panel.token.tokenId : Number.NaN,
                owner: verifiedAddress ?? '',
                recipient: expectedRecipient,
                networkPassphrase: client.passphrase,
                nftContractId: client.nftContractId,
                platformContracts: [
                  client.coreContractId,
                  client.tabContractId,
                  client.tokenContractId,
                ],
              },
        server: runtime.server,
        contracts: {
          core: client.coreContractId,
          tab: client.tabContractId,
          nft: client.nftContractId,
          token: client.tokenContractId,
        },
        connect: async () => {
          const current = wallet.getConnection()
          if (current) return current.address
          for (let i = 0; i < 50 && walletRef.current.isLoading; i++) {
            await new Promise((resolve) => setTimeout(resolve, 100))
          }
          const connected = await walletRef.current.connect()
          return connected ? (wallet.getConnection()?.address ?? null) : null
        },
        sign: async (xdr, signer) =>
          (await wallet.signTransaction(xdr, { address: signer })).signedTxXdr,
        recordSubmitted: async (submissionId, txHash) => {
          await recordSubmitted({
            submissionId: submissionId as Id<'chainSubmissions'>,
            txHash,
          })
        },
        recordFailed: async (submissionId, reason, detail) => {
          await recordSendFailed({
            submissionId: submissionId as Id<'chainSubmissions'>,
            reason,
            ...(detail ? { detail } : {}),
          })
        },
        onPhase: (step) => dispatch({ type: 'step', step }),
      })
      if (
        result.status === 'wallet_failed' &&
        result.error.kind === 'cancelled'
      ) {
        const key = keyFor(prepared.action)
        if (key) resumeStore.clear(key)
      }
      dispatch({ type: 'result', result })
    },
    [
      articleId,
      keyFor,
      nftId,
      panel,
      recordSendFailed,
      recordSubmitted,
      verifiedAddress,
    ]
  )

  const mint = useCallback(async () => {
    if (
      flowRef.current.kind === 'preparing' ||
      flowRef.current.kind === 'running'
    ) {
      return
    }
    dispatch({ type: 'start', action: 'mint' })
    let prepared: PreparedNftCall
    try {
      prepared = (await prepareMint({
        articleId,
        requestId: requestId(),
      })) as PreparedNftCall
    } catch (error) {
      const data = errorData(error)
      dispatch({ type: 'prepare-failed', action: 'mint', ...data })
      if (data.code === 'ALREADY_MINTED') refreshEligibility()
      return
    }
    resumeStore.write(mintKey, prepared.submissionId)
    dispatch({ type: 'prepared', prepared })
    await submit(prepared, null)
  }, [articleId, mintKey, prepareMint, refreshEligibility, submit])

  const [expectedRecipient, setExpectedRecipient] = useState<string | null>(
    null
  )
  const lastRecipient = useRef<RecipientInput | null>(null)

  const prepareTransferFor = useCallback(
    async (recipient: RecipientInput, refreshed = false) => {
      if (!nftId) return
      lastRecipient.current = recipient
      setExpectedRecipient(
        recipient.kind === 'address' ? recipient.address : null
      )
      dispatch({ type: 'start', action: 'transfer' })
      try {
        const prepared = (await prepareTransfer({
          nftId: nftId as Id<'articleNFTs'>,
          recipient:
            recipient.kind === 'address'
              ? { kind: 'address', address: recipient.address }
              : { kind: 'user', username: recipient.username },
          requestId: requestId(),
        })) as PreparedNftTransfer
        if (transferKey) resumeStore.write(transferKey, prepared.submissionId)
        dispatch({ type: 'prepared', prepared, refreshed })
      } catch (error) {
        dispatch({
          type: 'prepare-failed',
          action: 'transfer',
          ...errorData(error),
        })
      }
    },
    [nftId, prepareTransfer, transferKey]
  )

  const cancelPrepared = useCallback(
    async (submissionId: string) => {
      // Frees the token for a new request at once (PREPARED → FAILED).
      await recordSendFailed({
        submissionId: submissionId as Id<'chainSubmissions'>,
        reason: 'wallet_rejected',
        detail: 'cancelled',
      }).catch(() => {})
    },
    [recordSendFailed]
  )

  const confirmTransfer = useCallback(async () => {
    const current = flowRef.current
    if (current.kind !== 'review') return
    const { prepared } = current
    // A review left open too long is prepared again and shown again.
    if (Date.now() / 1000 > prepared.maxTime - REVIEW_MARGIN_SECONDS) {
      await cancelPrepared(prepared.submissionId)
      if (lastRecipient.current) {
        await prepareTransferFor(lastRecipient.current, true)
      }
      return
    }
    dispatch({ type: 'confirm' })
    // For a username, the user confirmed the address the review showed.
    await submit(
      prepared,
      expectedRecipient ??
        (prepared.action === 'transfer' ? prepared.args.to : null)
    )
  }, [cancelPrepared, expectedRecipient, prepareTransferFor, submit])

  const cancelReview = useCallback(async () => {
    const current = flowRef.current
    if (current.kind === 'review') {
      const id = current.prepared.submissionId
      dispatch({ type: 'dismiss' })
      if (transferKey) resumeStore.clear(transferKey)
      await cancelPrepared(id)
    }
  }, [cancelPrepared, transferKey])

  const dismiss = useCallback(() => {
    const current = flowRef.current
    if (current.kind === 'tracking' || current.kind === 'refused') {
      const key = keyFor(current.action)
      if (key) resumeStore.clear(key)
    }
    if (current.kind === 'gate' || current.kind === 'notice') {
      const key = keyFor(current.action)
      if (key) resumeStore.clear(key)
    }
    dispatch({ type: 'dismiss' })
  }, [keyFor])

  return {
    config,
    panel,
    progress,
    flow,
    status,
    eligibility,
    verifiedAddress,
    refreshEligibility,
    mint,
    prepareTransfer: prepareTransferFor,
    confirmTransfer,
    cancelReview,
    dismiss,
    platformContracts: config
      ? [
          config.nftContractId,
          config.coreContractId,
          config.tabContractId,
          config.tokenContractId,
        ]
      : [],
  }
}
