'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useMutation } from 'convex/react'
import { ConvexError } from 'convex/values'
import { api } from '@/convex/_generated/api'
import type { Id } from '@/convex/_generated/dataModel'
import { wallet } from '@/lib/stellar/v2/wallet-kit'
import {
  isWalletError,
  walletErrorMessage,
  type WalletMessage,
} from '@/lib/stellar/v2/wallet-errors'
import {
  WalletOwnershipError,
  ownershipErrorMessage,
  proveWalletOwnership,
  type OwnershipResult,
  type ProofMethod,
} from '@/lib/stellar/v2/wallet-ownership'

export type OwnershipStatus =
  | 'idle'
  | 'challenge'
  | 'sign'
  | 'verify'
  | 'verified'
  | 'error'

export type OwnershipState = {
  status: OwnershipStatus
  method: ProofMethod | null
  error: WalletMessage | null
  result: OwnershipResult | null
}

const IDLE: OwnershipState = {
  status: 'idle',
  method: null,
  error: null,
  result: null,
}

/** One proof at a time across the app, so two callers share one prompt. */
let inflight: Promise<OwnershipResult> | null = null

/** True while a proof is running anywhere in the app. */
export function walletProofInFlight(): boolean {
  return inflight !== null
}

/** Copy for any failure of `proveWalletOwnership`; null when cancelled. */
export function ownershipFailureMessage(error: unknown): WalletMessage | null {
  if (isWalletError(error)) return walletErrorMessage(error)
  if (error instanceof WalletOwnershipError) {
    return ownershipErrorMessage(error.reason)
  }
  if (error instanceof ConvexError && typeof error.data === 'string') {
    return ownershipErrorMessage(error.data)
  }
  return ownershipErrorMessage('UNKNOWN')
}

/**
 * Proves the connected wallet controls its address and links it as the
 * signed-in user's verified receiving address.
 */
export function useWalletOwnership() {
  const createChallenge = useMutation(api.walletLink.createWalletChallenge)
  const verifyChallenge = useMutation(api.walletLink.verifyWalletChallenge)
  const [state, setState] = useState<OwnershipState>(IDLE)
  const mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])

  const verify = useCallback(async (): Promise<OwnershipResult | null> => {
    const update = (next: Partial<OwnershipState>) => {
      if (mounted.current) setState((prev) => ({ ...prev, ...next }))
    }
    update({ status: 'challenge', error: null, result: null })
    try {
      inflight ??= proveWalletOwnership({
        wallet,
        origin: window.location.origin,
        createChallenge: (args) => createChallenge(args),
        verifyChallenge: (args) =>
          verifyChallenge({
            ...args,
            challengeId: args.challengeId as Id<'walletChallenges'>,
          }),
        onStep: (status, method) => update({ status, method }),
      }).finally(() => {
        inflight = null
      })
      const result = await inflight
      update({ status: 'verified', result })
      return result
    } catch (error) {
      const message = ownershipFailureMessage(error)
      update(message ? { status: 'error', error: message } : IDLE)
      return null
    }
  }, [createChallenge, verifyChallenge])

  const reset = useCallback(() => setState(IDLE), [])

  return { ...state, verify, reset }
}
