// Browser-only collaborators for the wallet fixture. They stand in for Convex,
// auth and the Stellar RPC client so the real wallet runtime, Wallets Kit and
// tip dialog can run against an emulated wallet. Nothing is sent to a network.
import { lazy, Suspense, createElement, type ComponentType } from 'react'
import {
  Account,
  Networks,
  Operation,
  TransactionBuilder,
} from '@stellar/stellar-sdk'

/** Records what reached the backend stand-ins, for assertions. */
type FixtureLog = { prepared: number; signedXdr: string | null }
declare global {
  interface Window {
    __walletFixture: FixtureLog
  }
}
window.__walletFixture = { prepared: 0, signedXdr: null }

const READER = 'GBZXN7PIRZGNMHGA7MUUUF4GWPY5AYPV6LY4UV2GL6VJGIQRXFDNMADI'
export const AUTHOR = 'GCS5XCIKIBZ3L5CUKJMMAG6IUBBNCCPT5SFTXFW5I4DZOMT4RJ43DUAR'

// `api.x.y` resolves to the string "x.y".
export const api: unknown = new Proxy(
  {},
  {
    get: (_, mod: string) =>
      new Proxy({}, { get: (_, fn: string) => `${mod}.${fn}` }),
  }
)

const hold = () => new Promise<never>(() => {})

export function useConvex() {
  return {
    query: async (name: string) => {
      if (name === 'tips.canTip') return { allowed: true, waitSec: 0 }
      if (name === 'xlmPrice.getCachedXlmPrice') return { price: 0.1 }
      return null
    },
  }
}

export function useMutation(name: string) {
  return async () => {
    if (name === 'tips.prepareArticleTip') {
      window.__walletFixture.prepared += 1
      return {
        stellarNetwork: 'TESTNET',
        articleSymbol: 'qa_article',
        authorAddress: AUTHOR,
        amountStroops: '10000000',
        amountCents: 10,
        contractId: 'C' + 'A'.repeat(55),
        intentId: 'qa-intent',
        timeBounds: {
          minTime: 0,
          maxTime: Math.floor(Date.now() / 1000) + 300,
        },
      }
    }
    // Registration and verification stay pending: nothing is submitted.
    return hold()
  }
}

export const useQuery = () => undefined

export function useAuth() {
  return {
    user: { _id: 'qa-reader', username: 'reader', name: 'Reader' },
    isAuthenticated: true,
    isLoading: false,
  }
}

export const stellarClient = {
  async buildTipTransaction(source: string) {
    const tx = new TransactionBuilder(new Account(source, '1'), {
      fee: '100',
      networkPassphrase: Networks.TESTNET,
    })
      .addOperation(Operation.manageData({ name: 'qa-fixture', value: 'tip' }))
      .setTimeout(300)
      .build()
    return { xdr: tx.toXDR() }
  },
  async deriveTipTransactionHash(signedXdr: string) {
    window.__walletFixture.signedXdr = signedXdr
    return 'f'.repeat(64)
  },
  submitTipTransaction: hold,
  getXLMPrice: async () => 0.1,
  getXLMPriceData: async () => ({ price: 0.1, change24h: 0 }),
}

export { READER }

/** next/dynamic without Next: React.lazy behind Suspense. */
export default function dynamic<P extends object>(
  loader: () => Promise<{ default: ComponentType<P> }>
) {
  const Lazy = lazy(loader)
  return (props: P) =>
    createElement(Suspense, { fallback: null }, createElement(Lazy, props))
}
