'use client'

/**
 * The live services of Add money, quick tips and turn off: the server for
 * the balance and the prepare steps, Stellar testnet RPC for the wallet's
 * funds, the contract's limits, building, simulating, sending and polling,
 * the browser's key store for this device's approval, and the wallet.
 * Loaded with the sheet (`import()`), never in a first load.
 *
 * Every request is built and simulated with the linked address as its
 * source before the wallet is asked, so its fee is shown first and refused
 * above a ceiling; the wallet signs exactly that envelope, and a signed
 * envelope whose hash differs is never sent.
 */
import { useEffect, useMemo, useState } from 'react'
import { useQuery, type ConvexReactClient } from 'convex/react'
import { TransactionBuilder, rpc, type Transaction } from '@stellar/stellar-sdk'
import { api } from '@/convex/_generated/api'
import type { Id } from '@/convex/_generated/dataModel'
import { bytesToHex } from '@/lib/stellar/bytes'
import { v2Config, type V2ClientConfig } from '@/lib/stellar/v2/config'
import {
  createSessionKeyStore,
  type SessionKeyScope,
  type SessionKeyStore,
} from '@/lib/stellar/v2/tab'
import { buildCall, pollTransaction } from '@/lib/stellar/v2/tx'
import { wallet } from '@/lib/stellar/v2/wallet-kit'
import { isWalletError, WalletError } from '@/lib/stellar/v2/wallet-errors'
import {
  proveWalletOwnership,
  ownershipErrorMessage,
  WalletOwnershipError,
} from '@/lib/stellar/v2/wallet-ownership'
import { seenKeyIds } from '@/lib/tab-ui/device-memory'
import {
  deviceKeyView,
  keyPlan,
  pendingLocalKey,
  localKeyIds,
} from '@/lib/tab-ui/key-plan'
import { convexErrorCode } from '@/lib/tab-ui/tip-flow'
import {
  readTabLimits,
  readWalletFunds,
  tabContractCall,
} from '@/lib/tab-ui/tab-calls'
import type { TabCall } from '@/lib/tab-ui/types'
import { OPERATION_TTL_SECONDS } from '@/lib/tab-ui/operation-flow'
import {
  StepError,
  type AddMoneyServices,
  type LedgerClock,
  type Operation,
  type PreparedRequest,
  type Reading,
  type WalletRow,
} from '../services'
import type { DeviceKind } from '../plan'
import { stepFailureFromWallet } from '../walletFailure'
import { FEE_CEILING_STROOPS } from '../fee'

/** Ledgers close about every 5 seconds. */
const LEDGER_MS = 5_000

let server: rpc.Server | null = null
function rpcServer(config: V2ClientConfig): rpc.Server {
  server ??= new rpc.Server(config.rpcUrl, { allowHttp: config.allowHttp })
  return server
}

let keyStore: SessionKeyStore | null = null
function keys(): SessionKeyStore {
  keyStore ??= createSessionKeyStore()
  return keyStore
}

function config(): V2ClientConfig & { tabContractId: string } {
  const c = v2Config()
  if (!c.tabContractId)
    throw new StepError({
      kind: 'refused',
      message: 'Adding money is not available on this site yet.',
    })
  return c as V2ClientConfig & { tabContractId: string }
}

function siteOf(url: string | undefined): string {
  try {
    return url ? new URL(url).host : ''
  } catch {
    return ''
  }
}

function howToUse(access: WalletRow['access'], url?: string): string {
  if (access === 'web') return `Opens ${siteOf(url)} in a new window`
  if (access === 'mobile') return 'Opens a wallet app on your phone'
  if (access === 'not-installed') return 'Browser extension'
  if (access === 'installed') return 'Installed'
  return 'Cannot be used on this page'
}

/** A wallet, server or network error as a step failure. */
function asStep(error: unknown, address?: string): StepError {
  if (error instanceof StepError) return error
  if (isWalletError(error))
    return new StepError(stepFailureFromWallet(error, address))
  if (error instanceof WalletOwnershipError)
    return new StepError({
      kind: 'refused',
      message: ownershipErrorMessage(error.reason).detail,
    })
  const refusal = convexErrorCode(error)
  if (refusal)
    return new StepError({
      kind: 'refused',
      message: refusal.message ?? 'Quilltip could not prepare this.',
    })
  if (typeof navigator !== 'undefined' && navigator.onLine === false)
    return new StepError({ kind: 'offline' })
  return new StepError({
    kind: 'refused',
    message: 'Quilltip could not reach Stellar testnet.',
  })
}

async function latestClock(c: V2ClientConfig): Promise<LedgerClock> {
  const latest = await rpcServer(c).getLatestLedger()
  const closedAt = Number(latest.closeTime) * 1000
  return {
    sequence: latest.sequence,
    closedAt: Number.isFinite(closedAt) && closedAt > 0 ? closedAt : Date.now(),
  }
}

/** This browser's pending key for the scope, or a new one. */
async function deviceKey(scope: SessionKeyScope) {
  const held = await keys().list(scope)
  const pending = pendingLocalKey(held.map((k) => k.info))
  if (pending)
    return { publicKey: pending.publicKey, extractable: pending.extractable }
  const created = await keys().generate(scope)
  return {
    publicKey: created.info.publicKey,
    extractable: created.info.extractable,
  }
}

/** The device's quick-tips state, as the money layer's signer reads it. */
function useDevice(
  address: string | null,
  serverKeys:
    | {
        keyId: number
        publicKey: string | null
        validUntilLedger: number
        revoked: boolean
      }[]
    | undefined,
  ledger: LedgerClock | null
): { kind: DeviceKind | null; keyId: number | null; here: number[] } {
  const [state, setState] = useState<{
    key: string
    kind: DeviceKind
    keyId: number | null
    here: number[]
  } | null>(null)
  const signature = `${address}|${(serverKeys ?? [])
    .map((k) => `${k.keyId}:${k.publicKey}:${k.revoked}:${k.validUntilLedger}`)
    .join(',')}|${ledger?.sequence ?? 'none'}`
  useEffect(() => {
    if (!address || !serverKeys) return
    let alive = true
    let tab: string
    try {
      tab = config().tabContractId
    } catch {
      return
    }
    const scope = { tabContractId: tab, readerAddress: address }
    void (async () => {
      try {
        await keys().bindKeyIds(
          scope,
          serverKeys.map((k) => ({ keyId: k.keyId, publicKey: k.publicKey }))
        )
        const held = (await keys().list(scope)).map((k) => k.info)
        const current = ledger
          ? ledger.sequence +
            Math.max(0, Math.floor((Date.now() - ledger.closedAt) / LEDGER_MS))
          : null
        const view = deviceKeyView({
          serverKeys,
          localKeys: held,
          currentLedger: current,
          seenKeyIds: seenKeyIds(tab, address),
        })
        if (alive)
          setState({
            key: signature,
            kind: view.kind,
            keyId: view.kind === 'ready' ? view.keyId : null,
            here: localKeyIds(held),
          })
      } catch {
        if (alive)
          setState({
            key: signature,
            kind: 'storage-unavailable',
            keyId: null,
            here: [],
          })
      }
    })()
    return () => {
      alive = false
    }
  }, [signature]) // eslint-disable-line react-hooks/exhaustive-deps
  if (!state || state.key !== signature)
    return { kind: null, keyId: null, here: state?.here ?? [] }
  return state
}

function useLiveReading(): Reading | undefined {
  const session = useQuery(api.balance.session, {})
  const tab = useQuery(api.tabs.getMyTab, {})
  const address = session?.wallet?.address ?? null
  const ledger = session?.ledger ?? null
  const serverKeys = tab === undefined ? undefined : (tab?.keys ?? [])
  const device = useDevice(address, serverKeys, ledger)
  return useMemo(() => {
    if (session === undefined || tab === undefined) return undefined
    if (session === null)
      return {
        userId: null,
        address: null,
        status: 'none',
        confirmed: '0',
        available: '0',
        priceUsd: null,
        priceAt: null,
        accepting: false,
        keys: [],
        device: null,
        deviceKeyId: null,
        ledger: null,
      }
    const quote = session.prices.find((p) => p.token === 'xlm') ?? null
    return {
      userId: session.userId,
      address,
      status: session.status === 'closing' ? 'closing' : session.status,
      confirmed: session.tokens[0]?.confirmed ?? '0',
      available: session.tokens[0]?.available ?? '0',
      priceUsd: quote?.usd ?? null,
      priceAt: quote?.at ?? null,
      accepting: session.settlement.enabled,
      keys: (tab?.keys ?? []).map((k) => ({
        keyId: k.keyId,
        publicKey: k.publicKey,
        validUntilLedger: k.validUntilLedger,
        revoked: k.revoked,
        spendLimit: k.spendLimit,
        acceptedTotal: k.acceptedTotal,
        here: device.here.includes(k.keyId),
      })),
      device: address ? device.kind : null,
      deviceKeyId: device.keyId,
      ledger,
    } satisfies Reading
  }, [session, tab, address, ledger, device])
}

/** The Tab call for an operation, with the server's prepare. */
async function prepareOnServer(
  convex: ConvexReactClient,
  op: Operation,
  address: string,
  c: V2ClientConfig & { tabContractId: string }
): Promise<{
  call: TabCall
  key: PreparedRequest['key']
  amount: string
  context: {
    networkPassphrase: string
    tabContractId: string
    readerAddress: string
  }
  clock: LedgerClock
}> {
  const clock = await latestClock(c)
  const scope = { tabContractId: c.tabContractId, readerAddress: address }
  if (op.kind === 'turn-off') {
    // Nothing is asked of the server here: turning off starts on the
    // reader's press (`stopKey`). The envelope names this site's own
    // contract and network.
    return {
      call: { method: 'revoke_key', keyId: op.keyId },
      key: null,
      amount: '0',
      context: {
        networkPassphrase: c.passphrase,
        tabContractId: c.tabContractId,
        readerAddress: address,
      },
      clock,
    }
  }
  if (op.kind === 'add' && !op.withQuickTips) {
    const context = await convex.mutation(api.tabs.prepareDeposit, {
      amount: op.amount,
    })
    return {
      call: { method: 'deposit', amount: op.amount },
      key: null,
      amount: op.amount,
      context,
      clock,
    }
  }
  const device = await deviceKey(scope)
  const plan = keyPlan({
    latestLedger: clock.sequence,
    tabBalanceAfter: op.kind === 'add' ? op.balanceAfter : op.balance,
  })
  const key = { publicKey: device.publicKey, ...plan }
  if (op.kind === 'add') {
    const context = await convex.mutation(api.tabs.prepareOpen, {
      amount: op.amount,
      ...key,
      extractable: device.extractable,
    })
    return {
      call: { method: 'open_session', amount: op.amount, key },
      key,
      amount: op.amount,
      context,
      clock,
    }
  }
  const context = await convex.mutation(api.tabs.prepareRegisterKey, {
    ...key,
    extractable: device.extractable,
  })
  return {
    call: { method: 'register_key', key },
    key,
    amount: '0',
    context,
    clock,
  }
}

export function createLiveServices(
  convex: ConvexReactClient
): AddMoneyServices {
  // A connection this sheet made, so leaving without sending ends it.
  return {
    useReading: useLiveReading,
    async facts(address) {
      const c = config()
      const [funds, limits] = await Promise.all([
        readWalletFunds(rpcServer(c), address).catch(() => undefined),
        readTabLimits(rpcServer(c), {
          tabContractId: c.tabContractId,
          networkPassphrase: c.passphrase,
        }).catch(() => null),
      ])
      return {
        // An account that does not exist yet can spend nothing.
        spendable: funds === undefined ? null : (funds?.spendable ?? '0'),
        limits,
      }
    },
    async wallets() {
      const options = await wallet.listWallets()
      return options.map((o) => ({
        id: o.id,
        name: o.name,
        access: o.access,
        howToUse:
          o.access === 'unavailable'
            ? (o.unavailableReason ?? howToUse(o.access))
            : howToUse(o.access, o.webUrl ?? o.url),
        icon: o.icon,
        installUrl: o.url,
        unavailableReason: o.unavailableReason,
      }))
    },
    connection() {
      const c = wallet.getConnection()
      return c
        ? { address: c.address, walletId: c.walletId, walletName: c.walletName }
        : null
    },
    async connect(walletId) {
      try {
        const c = await wallet.connect({ walletId })
        return {
          address: c.address,
          walletId: c.walletId,
          walletName: c.walletName,
        }
      } catch (error) {
        throw asStep(error)
      }
    },
    async disconnect() {
      await wallet.disconnect().catch(() => {})
    },
    async link() {
      try {
        const result = await proveWalletOwnership({
          wallet,
          origin: window.location.origin,
          createChallenge: (args) =>
            convex.mutation(api.walletLink.createWalletChallenge, args),
          verifyChallenge: (args) =>
            convex.mutation(api.walletLink.verifyWalletChallenge, {
              ...args,
              challengeId: args.challengeId as Id<'walletChallenges'>,
            }),
        })
        return result.address
      } catch (error) {
        throw asStep(error)
      }
    },
    async prepare(op, address) {
      try {
        const c = config()
        const server = await prepareOnServer(convex, op, address, c)
        // The server's answer must name this site's network, contract and
        // the linked address; anything else is never built.
        if (
          server.context.networkPassphrase !== c.passphrase ||
          server.context.tabContractId !== c.tabContractId ||
          server.context.readerAddress !== address
        )
          throw new StepError({
            kind: 'refused',
            message: 'Quilltip’s answer did not match this site’s network.',
          })
        const maxTime = Math.floor(Date.now() / 1000) + OPERATION_TTL_SECONDS
        const call = tabContractCall({
          call: server.call,
          source: address,
          tabContractId: c.tabContractId,
          networkPassphrase: c.passphrase,
          maxTime,
        })
        const rpcs = rpcServer(c)
        const built = await buildCall(rpcs, call)
        const simulation = await rpcs.simulateTransaction(built)
        if (rpc.Api.isSimulationError(simulation))
          throw new StepError({
            kind: 'refused',
            message: 'Stellar testnet would refuse this request.',
          })
        const prepared = rpc.assembleTransaction(built, simulation).build()
        const fee = prepared.fee
        if (BigInt(fee) > FEE_CEILING_STROOPS)
          throw new StepError({
            kind: 'fee-too-high',
            feeStroops: fee,
            ceilingStroops: FEE_CEILING_STROOPS.toString(),
          })
        return {
          xdr: prepared.toXDR(),
          hash: bytesToHex(prepared.hash()),
          feeStroops: fee,
          maxTime,
          amount: server.amount,
          key: server.key,
          clock: server.clock,
        }
      } catch (error) {
        throw asStep(error, address)
      }
    },
    async sign(prepared, address) {
      const c = config()
      const current = wallet.getConnection()
      if (!current)
        throw new StepError(
          stepFailureFromWallet(new WalletError('locked', 'Not connected'))
        )
      if (current.address !== address)
        throw new StepError({
          kind: 'wrong-account',
          expected: address,
          actual: current.address,
        })
      let signedXdr: string
      try {
        signedXdr = (await wallet.signTransaction(prepared.xdr, { address }))
          .signedTxXdr
      } catch (error) {
        throw asStep(error, address)
      }
      // Exactly what was shown, its fee included, or nothing is sent.
      const back = TransactionBuilder.fromXDR(
        signedXdr,
        c.passphrase
      ) as Transaction
      if (bytesToHex(back.hash()) !== prepared.hash)
        throw new StepError({ kind: 'envelope-changed' })
      return signedXdr
    },
    async send(signedXdr, prepared) {
      const c = config()
      const signed = TransactionBuilder.fromXDR(
        signedXdr,
        c.passphrase
      ) as Transaction
      const hash = bytesToHex(signed.hash())
      for (let attempt = 0; attempt < 6; attempt++) {
        let result: rpc.Api.SendTransactionResponse
        try {
          result = await rpcServer(c).sendTransaction(signed)
        } catch {
          // It may have reached the network: the poll decides.
          return hash
        }
        if (result.status === 'PENDING' || result.status === 'DUPLICATE')
          return result.hash || hash
        if (result.status === 'ERROR') throw new StepError({ kind: 'failed' })
        if (Date.now() + 2_000 > prepared.maxTime * 1000) break
        await new Promise((r) => setTimeout(r, 2_000))
      }
      throw new StepError({ kind: 'expired' })
    },
    async stopKey(keyId) {
      try {
        await convex.mutation(api.tabs.prepareRevokeKey, { keyId })
      } catch (error) {
        throw asStep(error)
      }
    },
    poll(hash, maxTime, signal) {
      return pollTransaction(
        { server: rpcServer(config()) },
        hash,
        maxTime,
        signal
      )
    },
    now: () => Date.now(),
  }
}
