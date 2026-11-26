'use client'

/**
 * Drives one v2 tip surface (article, highlight or basket): runs
 * `runTip`, follows `tipsV2.getTipStatus` until the server reports a final
 * state, and resumes after a reload from the stored submission
 * (lib/tip/v2/pending.ts). Loaded only with the tip dialog or the basket,
 * never in the article page's first load: it imports the wallet and RPC code.
 */
import { useCallback, useEffect, useReducer, useRef, useState } from 'react'
import { useMutation, useQuery } from 'convex/react'
import { api } from '@/convex/_generated/api'
import type { Id } from '@/convex/_generated/dataModel'
import type { PreparedTip } from '@/convex/tipsV2'
import { useAuth } from '@/components/providers/AuthContext'
import { useWallet } from '@/components/providers/WalletProvider'
import { wallet } from '@/lib/stellar/v2/wallet-kit'
import { v2Runtime, type V2Runtime } from '@/lib/stellar/v2/chain-runtime'
import { runTip } from '@/lib/stellar/v2/tip-actions'
import type { RequestedTipItem } from '@/lib/stellar/v2/tip-calls'
import { spendableBalance } from '@/lib/stellar/v2/balance'
import { PREPARE_REFUSAL_COPY } from '@/lib/copy/tip-flow'
import {
  INITIAL_FLOW,
  isFinalUiState,
  newRequestId,
  progressSource,
  tipFlowReducer,
} from '@/lib/tip/v2/flow'
import { refusalFromPrepareError } from '@/lib/tip/v2/prepare-errors'
import {
  clearPending,
  pendingKey,
  readPending,
  writePending,
} from '@/lib/tip/v2/pending'
import { shortAddress } from '@/lib/payments/format'

/** The client polls past `maxTime + 30 s` before calling the check slow. */
const SLOW_AFTER_SECONDS = 30

export type TipRunRequest = {
  request: RequestedTipItem[]
  prepare: (requestId: string) => Promise<PreparedTip>
}

export type UseTipV2FlowOptions = {
  /** Storage scope for reloads (`articleScope`, `highlightScope`, `basket`). */
  scope: string
  batch?: boolean
  /** For the below-minimum copy. */
  minTipCents?: number | null
  /** Called once a record exists (the basket locks its items). */
  onPrepared?: (prepared: PreparedTip) => void
}

function runtimeOrNull(): V2Runtime | null {
  try {
    return v2Runtime()
  } catch (error) {
    // The message names environment variables: log it, never show it.
    console.error('[tips] payments v2 is not configured', error)
    return null
  }
}

export function useTipV2Flow(options: UseTipV2FlowOptions) {
  const { user } = useAuth()
  const owner = user?._id ?? null
  const key = owner ? pendingKey(owner, options.scope) : null
  const [state, dispatch] = useReducer(tipFlowReducer, INITIAL_FLOW)
  const [prepared, setPrepared] = useState<PreparedTip | null>(null)
  const walletContext = useWallet({ activateOnMount: true })
  const walletRef = useRef(walletContext)
  walletRef.current = walletContext
  const optionsRef = useRef(options)
  optionsRef.current = options

  const recordSubmitted = useMutation(api.tipsV2.recordSubmitted)
  const recordSendFailed = useMutation(api.tipsV2.recordSendFailed)

  const record = useQuery(
    api.tipsV2.getTipStatus,
    state.submissionId
      ? { submissionId: state.submissionId as Id<'chainSubmissions'> }
      : 'skip'
  )

  // Resume the surface's last tip after a reload.
  const resumedKey = useRef<string | null>(null)
  useEffect(() => {
    if (!key || resumedKey.current === key) return
    resumedKey.current = key
    const pending = readPending(key)
    if (pending) {
      dispatch({
        type: 'resume',
        submissionId: pending.submissionId,
        txHash: pending.txHash,
      })
    }
  }, [key])

  // A record still PREPARED with a hash this browser sent: record it again.
  // A repeat with the same hash is free on the server.
  const rerecorded = useRef<string | null>(null)
  useEffect(() => {
    if (
      record?.status === 'PREPARED' &&
      state.stage === 'tracking' &&
      state.step === null &&
      state.txHash &&
      rerecorded.current !== state.submissionId
    ) {
      rerecorded.current = state.submissionId
      void recordSubmitted({
        submissionId: record.submissionId,
        txHash: state.txHash,
      }).catch(() => undefined)
    }
  }, [record, recordSubmitted, state])

  // The server has no such record for this account: forget it.
  useEffect(() => {
    if (record === null && state.stage === 'tracking' && state.step === null) {
      if (key) clearPending(key)
      dispatch({ type: 'reset' })
    }
  }, [key, record, state.stage, state.step])

  // "Still checking" once the client is past maxTime + 30 s.
  const [now, setNow] = useState(() => Date.now())
  const checking = record?.uiState === 'checking'
  useEffect(() => {
    if (!checking) return
    const timer = setInterval(() => setNow(Date.now()), 5_000)
    return () => clearInterval(timer)
  }, [checking])
  const slow =
    checking &&
    !!record &&
    now > (record.maxTime + SLOW_AFTER_SECONDS) * 1000 &&
    state.step === null

  const run = useCallback(
    async ({ request, prepare }: TipRunRequest) => {
      const runtime = runtimeOrNull()
      const requestId = newRequestId()
      dispatch({ type: 'start', requestId })
      setPrepared(null)
      if (!runtime) {
        dispatch({
          type: 'refused',
          refusal: {
            kind: 'refused',
            copy: PREPARE_REFUSAL_COPY.notConfigured,
            code: 'CHAIN_CONFIG_MISSING',
            itemIndex: null,
            amountField: false,
          },
        })
        return
      }
      const result = await runTip({
        config: runtime.config,
        server: runtime.server,
        request,
        requestId,
        prepare,
        connect: async () => {
          const current = wallet.getConnection()
          if (current) return current.address
          for (let i = 0; i < 50 && walletRef.current.isLoading; i++) {
            await new Promise((resolve) => setTimeout(resolve, 100))
          }
          const connected = await walletRef.current.connect()
          return connected ? (wallet.getConnection()?.address ?? null) : null
        },
        sign: async (xdr, address) =>
          (await wallet.signTransaction(xdr, { address })).signedTxXdr,
        recordSubmitted: async (submissionId, txHash) => {
          await recordSubmitted({
            submissionId: submissionId as Id<'chainSubmissions'>,
            txHash,
          })
        },
        recordSendFailed: async (submissionId, reason, detail) => {
          await recordSendFailed({
            submissionId: submissionId as Id<'chainSubmissions'>,
            reason,
            ...(detail ? { detail } : {}),
          })
        },
        onPrepared: (next) => {
          setPrepared(next)
          dispatch({ type: 'prepared', submissionId: next.submissionId })
          if (key) {
            writePending(key, {
              submissionId: next.submissionId,
              txHash: null,
              startedAt: Date.now(),
            })
          }
          optionsRef.current.onPrepared?.(next)
        },
        onStep: (step) => dispatch({ type: 'step', step }),
        onSent: (submissionId, txHash) => {
          if (key) {
            writePending(key, {
              submissionId,
              txHash,
              startedAt: Date.now(),
            })
          }
        },
      })

      switch (result.kind) {
        case 'prepare_failed':
          dispatch({
            type: 'refused',
            refusal: refusalFromPrepareError(result.error, {
              batch: optionsRef.current.batch,
              connectedAddress: wallet.getConnection()?.address ?? null,
              minTipCents: optionsRef.current.minTipCents,
            }),
          })
          return
        case 'check_failed':
          dispatch({
            type: 'check_failed',
            failure: PREPARE_REFUSAL_COPY.checkFailed(result.message),
          })
          return
        case 'wrong_account':
          dispatch({
            type: 'check_failed',
            failure: PREPARE_REFUSAL_COPY.wrongAccount(
              shortAddress(result.expected),
              shortAddress(result.actual)
            ),
          })
          return
        case 'tracking':
          dispatch({ type: 'pending_elsewhere' })
          return
        case 'sent':
          dispatch({
            type: 'outcome',
            view: {
              show: { kind: 'sent', hash: result.txHash },
              record: null,
            },
          })
          return
        case 'stopped': {
          const show = result.view.show
          if (key && (show.kind === 'cancelled' || show.kind === 'gate')) {
            // Nothing to follow: the reader goes back to the form.
            clearPending(key)
          }
          if (show.kind === 'notice' && key) clearPending(key)
          dispatch({ type: 'outcome', view: result.view })
          if (
            show.kind === 'notice' &&
            show.notice.kind === 'insufficient-balance'
          ) {
            const server = runtime.server as Partial<
              Parameters<typeof spendableBalance>[0]
            >
            const available =
              typeof server.getAccountEntry === 'function'
                ? await spendableBalance(
                    server as Parameters<typeof spendableBalance>[0],
                    result.prepared.tipperAddress
                  )
                : null
            dispatch({
              type: 'balance',
              needed: result.prepared.totals.grossBaseUnits,
              available: available ?? undefined,
            })
          }
          return
        }
      }
    },
    [key, recordSendFailed, recordSubmitted]
  )

  /** Back to the form; the stored submission is forgotten. */
  const reset = useCallback(() => {
    if (key) clearPending(key)
    setPrepared(null)
    dispatch({ type: 'reset' })
  }, [key])

  const dismiss = useCallback(() => dispatch({ type: 'dismiss' }), [])

  const source = progressSource(state, record ?? undefined, {
    batch: options.batch,
  })
  const final = isFinalUiState(record?.uiState)

  return {
    state,
    record,
    prepared,
    source,
    slow,
    final,
    run,
    reset,
    dismiss,
    wallet: walletContext,
  }
}
