/**
 * `TabServices` for the fixture page: the stand-in backend over HTTP, a
 * stand-in wallet, and the real browser tab library (IndexedDB, WebCrypto).
 */
import { useSyncExternalStore } from 'react'

import {
  createLocalLedger,
  createSessionKeyStore,
  type SessionKeyStore,
} from '../../../lib/stellar/v2/tab'
import type { WalletGateState } from '../../../lib/payments/ui-state'
import type {
  ChainConfigView,
  LedgerClock,
  MyTab,
  MyTabEarnings,
  MyTabTips,
  TabServices,
  TabLimits,
  WalletAccess,
  WalletFunds,
} from '../../../lib/tab-ui/types'
import { FIXTURE_PASSPHRASE, FIXTURE_TAB } from './constants'

type Snapshot = {
  loading?: boolean
  gate: WalletGateState['kind']
  address: string | null
  chainConfig: ChainConfigView
  tab: MyTab | null
  activity: MyTabTips | null
  earnings: MyTabEarnings | null
  claimable: string
  clock: LedgerClock
  funds: WalletFunds | null
  limits: TabLimits | null
  calls: string[]
}

class ConvexLikeError extends Error {
  constructor(readonly data: { code: string; message: string }) {
    super(data.message)
  }
}

export function createFixtureServices(params: {
  session: string
  state: string
}): TabServices & { snapshot(): Snapshot | null } {
  const query = `session=${encodeURIComponent(params.session)}&state=${encodeURIComponent(params.state)}`
  async function post<T>(path: string, body: unknown): Promise<T> {
    const res = await fetch(`/api/${path}?${query}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    const data = (await res.json()) as T & { code?: string; message?: string }
    if (res.status === 409) {
      throw new ConvexLikeError({
        code: data.code!,
        message: data.message ?? '',
      })
    }
    if (!res.ok) throw new TypeError(`Failed to fetch (${res.status})`)
    return data
  }

  let snapshot: Snapshot | null = null
  const listeners = new Set<() => void>()
  let timer: ReturnType<typeof setInterval> | null = null
  async function refresh() {
    try {
      const res = await fetch(`/api/state?${query}`, { cache: 'no-store' })
      const next = (await res.json()) as Snapshot
      const changed = JSON.stringify(next) !== JSON.stringify(snapshot)
      snapshot = next
      if (changed) listeners.forEach((l) => l())
    } catch {
      // The next tick tries again.
    }
  }
  function subscribe(listener: () => void) {
    listeners.add(listener)
    if (!timer) {
      void refresh()
      timer = setInterval(refresh, 200)
    }
    return () => {
      listeners.delete(listener)
      if (listeners.size === 0 && timer) {
        clearInterval(timer)
        timer = null
      }
    }
  }
  const useSnapshot = () =>
    useSyncExternalStore(
      subscribe,
      () => snapshot,
      () => null
    )
  const ready = (s: Snapshot | null) => (s && !s.loading ? s : undefined)

  let store: SessionKeyStore | null = null
  const keyStore = () => (store ??= createSessionKeyStore())

  const signer = { current: null as string | null }

  return {
    snapshot: () => snapshot,
    config: () => ({
      networkPassphrase: FIXTURE_PASSPHRASE,
      tabContractId: FIXTURE_TAB,
    }),
    useMyTab: () => {
      const s = ready(useSnapshot())
      return s ? (s.address ? s.tab : null) : undefined
    },
    useMyTabTips: () => {
      const s = ready(useSnapshot())
      return s ? (s.address ? s.activity : null) : undefined
    },
    useMyTabEarnings: () => {
      const s = ready(useSnapshot())
      return s ? (s.address ? s.earnings : null) : undefined
    },
    useChainConfig: () => ready(useSnapshot())?.chainConfig,
    useWalletAccess: (): WalletAccess => {
      const s = useSnapshot()
      const kind = s && !s.loading ? s.gate : 'checking'
      const gate: WalletGateState =
        kind === 'wrong-network'
          ? { kind, walletNetwork: 'Mainnet' }
          : kind === 'unverified'
            ? {
                kind,
                address:
                  'GBZXN7PIRZGNMHGA7MUUUF4GWPY5AYPV6LY4UV2GL6VJGIQRXFDNMADI',
              }
            : ({ kind } as WalletGateState)
      signer.current = s?.address ?? null
      const control = (patch: Record<string, unknown>) =>
        void post('control', { patch })
      return {
        gate,
        address: s && !s.loading ? s.address : null,
        onSignIn: () => control({ gate: 'unverified' }),
        onInstall: () => control({ gate: 'disconnected' }),
        onConnect: () => control({ gate: 'ready' }),
        onRecheck: () => control({ gate: 'ready' }),
        verifyHref: '#verify',
      }
    },

    prepareOpen: (args) => post('prepare', { method: 'open_session', args }),
    prepareDeposit: (args) => post('prepare', { method: 'deposit', args }),
    prepareRegisterKey: (args) =>
      post('prepare', { method: 'register_key', args }),
    prepareRevokeKey: (args) => post('prepare', { method: 'revoke_key', args }),
    prepareWithdrawStart: () => post('prepare', { method: 'withdraw_start' }),
    prepareWithdraw: () => post('prepare', { method: 'withdraw' }),
    prepareTip: (args) => post('prepareTip', args),
    submitTip: (args) => post('submitTip', args),

    latestLedger: async () => {
      await refresh()
      if (!snapshot || snapshot.loading) throw new Error('loading')
      return snapshot.clock
    },
    walletFunds: async () => {
      await refresh()
      return snapshot?.funds ?? null
    },
    tabLimits: async () => {
      await refresh()
      return snapshot?.limits ?? null
    },
    claimable: async () => {
      await refresh()
      return snapshot?.claimable ?? '0'
    },
    send: async (request, onStep) => {
      onStep?.('simulating')
      await new Promise((r) => setTimeout(r, 120))
      const answer = await post<
        { hang?: 'simulating' | 'signing' | 'sending' } & Record<
          string,
          unknown
        >
      >('send', { call: request.call, signer: request.source })
      if (answer.hang) {
        if (answer.hang !== 'simulating') onStep?.('signing')
        if (answer.hang === 'sending') onStep?.('sending')
        return new Promise(() => {})
      }
      if (answer.status === 'sent' || answer.status === 'send_error') {
        onStep?.('signing')
        onStep?.('sending')
      } else if (answer.status === 'wallet_failed') {
        onStep?.('signing')
      }
      return answer as never
    },
    poll: async (hash, maxTime, signal) => {
      const res = await fetch(`/api/poll?${query}`, {
        method: 'POST',
        body: JSON.stringify({ hash, maxTime }),
        signal,
      })
      return (await res.json()) as 'SUCCESS' | 'FAILED' | 'TIMEOUT'
    },

    keyStore,
    signingDeps: (readerAddress) => ({
      keys: keyStore(),
      ledger: createLocalLedger(),
      networkPassphrase: FIXTURE_PASSPHRASE,
      tabContractId: FIXTURE_TAB,
      readerAddress,
    }),
    now: () => Date.now(),
    newRequestId: () => crypto.randomUUID(),
  }
}
