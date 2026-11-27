'use client'

/**
 * The app's `TabServices`: Convex for the tab ledger, the wallet for
 * signatures, Stellar RPC for views and sending, and the browser tab library
 * for session keys. Imported only by the tab screens' lazy entry points, so
 * none of it reaches a first load (scripts/perf).
 */
import { useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { useMutation, useQuery } from 'convex/react'
import { rpc } from '@stellar/stellar-sdk'
import { api } from '@/convex/_generated/api'
import type { Id } from '@/convex/_generated/dataModel'
import { useAuth } from '@/components/providers/AuthContext'
import { useWallet } from '@/components/providers/WalletProvider'
import { walletNetworkLabel } from '@/lib/payments/failures'
import type { WalletGateState } from '@/lib/payments/ui-state'
import { v2Config } from '@/lib/stellar/v2/config'
import {
  createSessionKeyStore,
  defaultTabSigningDeps,
  type SessionKeyStore,
} from '@/lib/stellar/v2/tab'
import { pollTransaction, sendContractCall } from '@/lib/stellar/v2/tx'
import { wallet } from '@/lib/stellar/v2/wallet-kit'
import {
  readClaimable,
  readTabLimits,
  readWalletFunds,
  tabContractCall,
} from '@/lib/tab-ui/tab-calls'
import type {
  TabClientConfig,
  TabServices,
  WalletAccess,
} from '@/lib/tab-ui/types'

let server: rpc.Server | null = null
function rpcServer(): rpc.Server {
  if (!server) {
    const config = v2Config()
    server = new rpc.Server(config.rpcUrl, { allowHttp: config.allowHttp })
  }
  return server
}

let keyStore: SessionKeyStore | null = null
function sharedKeyStore(): SessionKeyStore {
  keyStore ??= createSessionKeyStore()
  return keyStore
}

const VERIFY_HREF = '/dashboard/wallet'
const INSTALL_HREF = '/wallet/practice#wallet-help'

function useLiveWalletAccess(): WalletAccess {
  const router = useRouter()
  const { user, isLoading, isAuthenticated } = useAuth()
  const walletState = useWallet({ activateOnMount: true })
  return useMemo<WalletAccess>(() => {
    let passphrase: string | null = null
    try {
      passphrase = v2Config().passphrase
    } catch {
      passphrase = null
    }
    const verified =
      user?.stellarAddress &&
      typeof user.stellarAddressVerifiedAt === 'number' &&
      user.stellarAddressVerifiedNetwork === passphrase
        ? user.stellarAddress
        : null
    let gate: WalletGateState
    if (isLoading) gate = { kind: 'checking' }
    else if (!isAuthenticated || !user) gate = { kind: 'signed-out' }
    else if (walletState.isLoading) gate = { kind: 'checking' }
    else if (walletState.errorKind === 'locked') gate = { kind: 'locked' }
    else if (!walletState.isConnected && !walletState.isInstalled)
      gate = { kind: 'no-wallet' }
    else if (!walletState.isConnected) gate = { kind: 'disconnected' }
    else if (
      walletState.networkReported &&
      walletState.networkPassphrase !== passphrase
    )
      gate = {
        kind: 'wrong-network',
        walletNetwork: walletNetworkLabel(
          walletState.networkPassphrase ?? undefined
        ),
      }
    else if (!verified || walletState.publicKey !== verified)
      gate = {
        kind: 'unverified',
        ...(walletState.publicKey ? { address: walletState.publicKey } : {}),
      }
    else gate = { kind: 'ready' }
    return {
      gate,
      address: verified,
      onSignIn: () =>
        router.push(
          `/login?next=${encodeURIComponent(window.location.pathname)}`
        ),
      onInstall: () => router.push(INSTALL_HREF),
      onConnect: () => {
        void walletState.connect().catch(() => {})
      },
      onRecheck: () => {
        void walletState.refreshConnection().catch(() => {})
      },
      verifyHref: VERIFY_HREF,
    }
  }, [user, isLoading, isAuthenticated, walletState, router])
}

/** One `TabServices` object per mount; its hooks are called in a fixed order. */
export function useLiveTabServices(): TabServices {
  const prepareOpen = useMutation(api.tabs.prepareOpen)
  const prepareDeposit = useMutation(api.tabs.prepareDeposit)
  const prepareRegisterKey = useMutation(api.tabs.prepareRegisterKey)
  const prepareRevokeKey = useMutation(api.tabs.prepareRevokeKey)
  const prepareWithdrawStart = useMutation(api.tabs.prepareWithdrawStart)
  const prepareWithdraw = useMutation(api.tabs.prepareWithdraw)
  const prepareTip = useMutation(api.tabs.prepareTip)
  const submitTip = useMutation(api.tabs.submitTip)

  return useMemo<TabServices>(
    () => ({
      config: liveTabConfig,
      useMyTab: () => useQuery(api.tabs.getMyTab, {}),
      useMyTabTips: () => useQuery(api.tabActivity.getMyTabTips, {}),
      useMyTabEarnings: () => useQuery(api.tabActivity.getMyTabEarnings, {}),
      useChainConfig: () => useQuery(api.chain.config.getChainConfig, {}),
      useTabSettlement: () => useQuery(api.tabActivity.getTabSettlement, {}),
      useWalletAccess: useLiveWalletAccess,

      prepareOpen: (args) => prepareOpen(args),
      prepareDeposit: (args) => prepareDeposit(args),
      prepareRegisterKey: (args) => prepareRegisterKey(args),
      prepareRevokeKey: (args) => prepareRevokeKey(args),
      prepareWithdrawStart: () => prepareWithdrawStart({}),
      prepareWithdraw: () => prepareWithdraw({}),
      prepareTip: async (args) => {
        const prepared = await prepareTip({
          ...args,
          articleId: args.articleId as Id<'articles'>,
        })
        return { ...prepared, prepareId: prepared.prepareId as string }
      },
      submitTip: async (args) => {
        const accepted = await submitTip({
          ...args,
          prepareId: args.prepareId as Id<'tips'> | Id<'highlightTips'>,
        })
        return { ...accepted, receiptId: accepted.receiptId as string }
      },

      latestLedger: async () => {
        const latest = await rpcServer().getLatestLedger()
        const closedAt = Number(latest.closeTime) * 1000
        return {
          sequence: latest.sequence,
          closedAt:
            Number.isFinite(closedAt) && closedAt > 0 ? closedAt : Date.now(),
        }
      },
      walletFunds: (address) => readWalletFunds(rpcServer(), address),
      tabLimits: async () => {
        const config = v2Config()
        if (!config.tabContractId) return null
        try {
          return await readTabLimits(rpcServer(), {
            tabContractId: config.tabContractId,
            networkPassphrase: config.passphrase,
          })
        } catch {
          return null
        }
      },
      claimable: (address) => {
        const config = v2Config()
        return readClaimable(rpcServer(), {
          tabContractId: config.tabContractId!,
          networkPassphrase: config.passphrase,
          owner: address,
        })
      },
      send: (request, onStep) =>
        sendContractCall(
          {
            server: rpcServer(),
            sign: async (xdr) =>
              (await wallet.signTransaction(xdr, { address: request.source }))
                .signedTxXdr,
            onStep,
            // Decode an error code only when it was raised by the Tab
            // contract the call names, or by the token it moves.
            contracts: {
              tab: request.tabContractId,
              token: v2Config().tokenContractId,
            },
          },
          tabContractCall(request)
        ),
      poll: (hash, maxTime, signal) =>
        pollTransaction({ server: rpcServer() }, hash, maxTime, signal),

      keyStore: sharedKeyStore,
      signingDeps: (readerAddress) => ({
        ...defaultTabSigningDeps({ readerAddress }),
        keys: sharedKeyStore(),
      }),
      now: () => Date.now(),
      newRequestId: () => crypto.randomUUID(),
    }),
    [
      prepareOpen,
      prepareDeposit,
      prepareRegisterKey,
      prepareRevokeKey,
      prepareWithdrawStart,
      prepareWithdraw,
      prepareTip,
      submitTip,
    ]
  )
}

/** The configured network passphrase and Tab contract, or null when v2 is off. */
export function liveTabConfig(): TabClientConfig | null {
  try {
    const config = v2Config()
    return config.tabContractId
      ? {
          networkPassphrase: config.passphrase,
          tabContractId: config.tabContractId,
        }
      : null
  } catch {
    return null
  }
}
