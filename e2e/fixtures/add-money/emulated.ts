/**
 * An emulated wallet and Stellar testnet for the Add money fixture: no
 * network, no keys, no secrets. The address picks the starting state; the
 * test steers the wallet's next answer through `window.__wallet`.
 *
 *   ?linked=no        no wallet linked to the account yet
 *   ?balance=<xlm>    the balance on chain (default 4; 0 with status none)
 *   ?device=<kind>    this device's quick tips (default none)
 *   ?spendable=<xlm>  what the wallet can spend (default 500)
 *   ?price=none       no dollar price
 *   ?paused           Quilltip accepts no tips from balances
 *   ?full             the balance is at its limit
 *   ?connected        a wallet is already connected in the page
 *   ?other-key        another device has quick tips
 *   ?slow             the network takes 25 s to confirm
 *
 * `window.__wallet.next`: approve (default), decline, close, blocked,
 * wrong-network, wrong-account, offline, fail, locked.
 */
import type { DeviceKind } from '../../../lib/addMoney/plan'
import {
  StepError,
  type AddMoneyServices,
  type DeviceKey,
  type Operation,
  type PreparedRequest,
  type Reading,
  type StepFailure,
  type WalletConnection,
  type WalletRow,
} from '../../../lib/addMoney/services'
import { useSyncExternalStore } from 'react'

const XLM = BigInt(10_000_000)
const DAY = 17_280
export const ADDRESS =
  'GABCDEFGHIJKLMNOPQRSTUVWXYZ234567ABCDEFGHIJKLMNOPQRSWXYZ'
const OTHER = 'GDEFDEFGHIJKLMNOPQRSTUVWXYZ234567ABCDEFGHIJKLMNOPQRSSTUV'
const params = new URLSearchParams(location.search)
const xlm = (value: string | null, fallback: number) =>
  BigInt(Math.round(Number(value ?? fallback) * 1e7)).toString()

type Next =
  | 'approve'
  | 'decline'
  | 'close'
  | 'blocked'
  | 'wrong-network'
  | 'wrong-account'
  | 'offline'
  | 'fail'
  | 'locked'

type Log = {
  /** Every request the wallet was asked to sign, by kind. */
  signed: string[]
  /** Every transaction sent to the network. */
  sent: string[]
  /** Tips sent (the article's tip button). Add money must never add one. */
  tips: number
  /** Keys stopped in Quilltip (turn off). */
  stopped: number[]
  /** Keys this browser replaced with a newer approval. */
  retired: number[]
}

declare global {
  interface Window {
    __wallet: { next: Next; log: Log }
  }
}
window.__wallet = {
  next: 'approve',
  log: { signed: [], sent: [], tips: 0, stopped: [], retired: [] },
}

const now = () => Date.now()
const ledger = { sequence: 1_000_000, closedAt: now() }
const balance = xlm(params.get('balance'), params.has('linked') ? 0 : 4)
const startKeys: DeviceKey[] = []
const device = (params.get('device') ?? 'none') as DeviceKind
if (device === 'ready' || device === 'expired' || device === 'unchecked')
  startKeys.push({
    keyId: 0,
    publicKey: '11'.repeat(32),
    validUntilLedger:
      device === 'expired'
        ? ledger.sequence + DAY / 2
        : ledger.sequence + 5 * DAY,
    revoked: false,
    spendLimit: (BigInt(50) * XLM).toString(),
    acceptedTotal: (BigInt(12) * XLM).toString(),
    here: true,
    retired: false,
  })
if (params.has('other-key'))
  startKeys.push({
    keyId: 1,
    publicKey: '22'.repeat(32),
    validUntilLedger: ledger.sequence + 6 * DAY,
    revoked: false,
    spendLimit: (BigInt(50) * XLM).toString(),
    acceptedTotal: (BigInt(3) * XLM).toString(),
    here: false,
    retired: false,
  })

let reading: Reading = {
  userId: 'reader',
  address: params.get('linked') === 'no' ? null : ADDRESS,
  status: BigInt(balance) > BigInt(0) ? 'open' : 'none',
  confirmed: balance,
  available: balance,
  priceUsd: params.get('price') === 'none' ? null : 0.1273,
  priceAt: now(),
  accepting: !params.has('paused'),
  keys: startKeys,
  device,
  deviceKeyId: device === 'ready' ? 0 : null,
  ledger,
}
const listeners = new Set<() => void>()
function set(next: Partial<Reading>) {
  reading = { ...reading, ...next }
  listeners.forEach((l) => l())
}
export function readingNow(): Reading {
  return reading
}
export function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}
/** The fixture's tip, for the article's button: counted, never sent. */
export function recordTip() {
  window.__wallet.log.tips += 1
}

let connection: WalletConnection | null = params.has('connected')
  ? { address: ADDRESS, walletId: 'albedo', walletName: 'Albedo' }
  : null

const pause = (ms: number) => new Promise((r) => setTimeout(r, ms))

function walletAnswer(walletName: string): StepFailure | null {
  switch (window.__wallet.next) {
    case 'decline':
    case 'close':
      return { kind: 'cancelled' }
    case 'blocked':
      return { kind: 'popup-blocked', wallet: walletName }
    case 'wrong-network':
      return { kind: 'wrong-network', when: 'after', network: null }
    case 'locked':
      return { kind: 'locked', wallet: walletName }
    default:
      return null
  }
}

let nextKey = 2
const WALLETS: WalletRow[] = [
  {
    id: 'xbull',
    name: 'xBull',
    access: 'web',
    howToUse: 'Opens wallet.xbull.app in a new window',
  },
  {
    id: 'albedo',
    name: 'Albedo',
    access: 'web',
    howToUse: 'Opens albedo.link in a new window',
  },
  {
    id: 'varial',
    name: 'Varial',
    access: 'not-installed',
    howToUse: 'Browser extension',
    installUrl: 'https://example.invalid/varial',
  },
]

export const emulatedServices: AddMoneyServices = {
  useReading: () => useSyncExternalStore(subscribe, readingNow),
  async facts() {
    await pause(150)
    const room = params.has('full')
      ? reading.confirmed
      : (BigInt(1000) * XLM).toString()
    return {
      spendable: xlm(params.get('spendable'), 500),
      limits: { minDeposit: (BigInt(10) * XLM).toString(), maxBalance: room },
    }
  },
  async wallets() {
    await pause(100)
    return WALLETS
  },
  connection: () => connection,
  async connect(walletId) {
    await pause(300)
    const row = WALLETS.find((w) => w.id === walletId)!
    const failure = walletAnswer(row.name)
    if (failure) {
      window.__wallet.next = 'approve'
      throw new StepError(failure)
    }
    const address = window.__wallet.next === 'wrong-account' ? OTHER : ADDRESS
    if (window.__wallet.next === 'wrong-account')
      window.__wallet.next = 'approve'
    connection = { address, walletId, walletName: row.name }
    return connection
  },
  async disconnect() {
    connection = null
  },
  async link() {
    await pause(300)
    const failure = walletAnswer(connection?.walletName ?? 'Your wallet')
    if (failure) {
      window.__wallet.next = 'approve'
      throw new StepError(failure)
    }
    window.__wallet.log.signed.push('link')
    set({ address: connection!.address })
    return connection!.address
  },
  async prepare(op: Operation) {
    await pause(200)
    if (window.__wallet.next === 'offline') {
      window.__wallet.next = 'approve'
      throw new StepError({ kind: 'offline' })
    }
    const key =
      op.kind === 'turn-off' || (op.kind === 'add' && !op.withQuickTips)
        ? null
        : {
            publicKey: (nextKey++).toString(16).padStart(2, '0').repeat(32),
            validUntil: ledger.sequence + 7 * DAY,
            spendLimit: (() => {
              const after = BigInt(
                op.kind === 'add' ? op.balanceAfter : op.balance
              )
              const cap = BigInt(50) * XLM
              return (after > BigInt(0) && after < cap ? after : cap).toString()
            })(),
          }
    const kind =
      op.kind === 'add'
        ? op.withQuickTips
          ? 'open_session'
          : 'deposit'
        : op.kind === 'quick-tips'
          ? 'register_key'
          : `revoke_key:${op.keyId}`
    return {
      xdr: kind,
      hash: `hash-${kind}`,
      feeStroops: op.kind === 'add' ? '4213' : '2134',
      maxTime: Math.floor(now() / 1000) + 300,
      amount: op.kind === 'add' ? op.amount : '0',
      key,
      clock: ledger,
    } satisfies PreparedRequest
  },
  async sign(prepared) {
    await pause(400)
    const failure = walletAnswer(connection?.walletName ?? 'Your wallet')
    if (failure) {
      window.__wallet.next = 'approve'
      throw new StepError(failure)
    }
    if (window.__wallet.next === 'wrong-account') {
      window.__wallet.next = 'approve'
      throw new StepError({
        kind: 'wrong-account',
        expected: ADDRESS,
        actual: OTHER,
      })
    }
    window.__wallet.log.signed.push(prepared.xdr)
    return `signed:${prepared.xdr}`
  },
  async send(signed, prepared) {
    if (window.__wallet.next === 'fail') {
      window.__wallet.next = 'approve'
      throw new StepError({ kind: 'failed' })
    }
    window.__wallet.log.sent.push(signed)
    // The indexer reads it back a moment later (or much later with ?slow).
    setTimeout(
      () => {
        const amount = BigInt(prepared.amount)
        const confirmed = (BigInt(reading.confirmed) + amount).toString()
        const available = (BigInt(reading.available) + amount).toString()
        let keys = reading.keys
        let next: Partial<Reading> = {}
        if (prepared.xdr.startsWith('revoke_key')) {
          const id = Number(prepared.xdr.split(':')[1])
          keys = keys.map((k) =>
            k.keyId === id
              ? { ...k, revoked: true, validUntilLedger: ledger.sequence }
              : k
          )
          if (id === reading.deviceKeyId)
            next = { device: 'revoked', deviceKeyId: null }
        } else if (prepared.key) {
          const keyId = keys.length + 10
          keys = [
            ...keys,
            {
              keyId,
              publicKey: prepared.key.publicKey,
              validUntilLedger: prepared.key.validUntil,
              revoked: false,
              spendLimit: prepared.key.spendLimit,
              acceptedTotal: '0',
              here: true,
              retired: false,
            },
          ]
          next = { device: 'ready', deviceKeyId: keyId }
        }
        set({
          confirmed,
          available,
          keys,
          status: BigInt(confirmed) > BigInt(0) ? 'open' : reading.status,
          ...next,
        })
      },
      params.has('slow') ? 25_000 : 600
    )
    return `tx-${prepared.xdr}`
  },
  async poll() {
    await pause(params.has('slow') ? 26_000 : 500)
    return 'SUCCESS'
  },
  async retireOtherKeys(_address, keepPublicKey) {
    const older = reading.keys.filter(
      (k) => k.here && !k.revoked && k.publicKey !== keepPublicKey
    )
    window.__wallet.log.retired.push(...older.map((k) => k.keyId))
    set({
      keys: reading.keys.map((k) =>
        older.includes(k)
          ? { ...k, revoked: true, retired: true, here: false }
          : k
      ),
    })
  },
  async stopKey(keyId) {
    await pause(150)
    window.__wallet.log.stopped.push(keyId)
    const keys = reading.keys.map((k) =>
      k.keyId === keyId ? { ...k, revoked: true } : k
    )
    set({
      keys,
      ...(keyId === reading.deviceKeyId
        ? { device: 'revoked' as const, deviceKeyId: null }
        : {}),
    })
  },
  now,
}
