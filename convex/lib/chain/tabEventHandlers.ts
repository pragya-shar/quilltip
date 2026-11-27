/**
 * Handlers for Tab contract events (contracts/tab/src/events.rs;
 * docs/architecture/v2/03-tab-contract.md, section 3.9; 05-flows-and-admin.md,
 * sections 5.5 to 5.9; 06-app-integration.md, section 6.5).
 *
 * Each handler reads the stored, JSON-safe event and is idempotent. Ordering:
 *
 * - **Balance.** `Deposited`, `WithdrawStarted`, `WithdrawCancelled` and
 *   `Withdrawn` carry the absolute balance; `TabSettled` carries a debit. An
 *   absolute balance applies only when its event is newer than the last one
 *   applied, minus the debits of newer `TabSettled` events already seen. A
 *   debit older than the applied absolute balance is already included in it.
 * - **Status** (`OPEN`, `CLOSING`, `CLOSED`) follows the newest status event.
 * - **Keys.** Revocation only lowers `valid_until` and never un-revokes, so
 *   `KeyRegistered` and `KeyRevoked` give the same result in either order.
 * - **Payments.** `paidOnChain` only grows (`max`), so a replayed or late
 *   `TabSettled` cannot lower it. The settler's own record of a settlement
 *   can arrive before or after the event; until the event's debit is
 *   applied, the paid amount stays reserved as `settledUnindexed`. An
 *   absolute balance from a later ledger than every unindexed payment of a
 *   pair already includes those debits, so it releases that reserve
 *   (`releaseIncludedReserves`); the late event then neither debits nor
 *   releases again.
 */
import { StrKey } from '@stellar/stellar-sdk'
import type { Doc } from '../../_generated/dataModel'
import type { MutationCtx } from '../../_generated/server'
import { readChainEnv } from './env'
import { isHexOfLength } from './ids'
import type { ChainEventHandler, IndexedEvent } from './indexerStore'
import {
  MAX_SETTLED_SINCE_BALANCE,
  adjustBaseUnitEarnings,
  applyPairPayment,
  applyPairSettlement,
  insertTabAccount,
  refreshSettleQueue,
  releaseIncludedReserves,
  resolveUnpaidPairs,
  tabAccountForReader,
  tabKey,
  tabVoucher,
  unblockAccountPairs,
  uniqueVerifiedUser,
  updateKeySettleBy,
} from './tabLedger'

type Data = Record<string, unknown>

class StoredEventError extends Error {}

const ZERO = BigInt(0)

function data(event: IndexedEvent): Data {
  const value = event.doc.data
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new StoredEventError(`${event.doc.type}: data is not a map`)
  }
  return value as Data
}

function address(value: unknown, field: string): string {
  if (
    typeof value !== 'string' ||
    !(StrKey.isValidEd25519PublicKey(value) || StrKey.isValidContract(value))
  ) {
    throw new StoredEventError(`${field} is not an address`)
  }
  return value
}

function int(value: unknown, field: string): bigint {
  if (typeof value !== 'string' || !/^-?[0-9]+$/.test(value)) {
    throw new StoredEventError(`${field} is not an integer`)
  }
  return BigInt(value)
}

function u32(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    throw new StoredEventError(`${field} is not a u32`)
  }
  return value
}

function hex32(value: unknown, field: string): string {
  if (typeof value !== 'string' || !isHexOfLength(value, 32)) {
    throw new StoredEventError(`${field} is not 32 bytes`)
  }
  return value
}

function passphrase(): string {
  return readChainEnv().passphrase
}

/**
 * The reader's tab account in the event's epoch. `Deposited` and
 * `KeyRegistered` (the events of `open_session`) create it for a reader whose
 * address exactly one user verified; other events never create one.
 */
async function accountFor(
  ctx: MutationCtx,
  event: IndexedEvent,
  reader: string,
  create: boolean
): Promise<Doc<'tabAccounts'> | null> {
  const existing = await tabAccountForReader(ctx, reader, event.doc.chainEpoch)
  if (existing || !create) return existing
  const user = await uniqueVerifiedUser(ctx, reader, passphrase())
  if (!user) return null
  return insertTabAccount(ctx, {
    network: event.doc.network,
    chainEpoch: event.doc.chainEpoch,
    userId: user._id,
    readerAddress: reader,
    tabContractId: event.doc.contractId,
    now: event.now,
  })
}

/** Patch for an absolute balance, or null when a newer one is applied. */
function absoluteBalance(
  account: Doc<'tabAccounts'>,
  event: IndexedEvent,
  balance: bigint
): Partial<Doc<'tabAccounts'>> | null {
  const eventId = event.doc.eventId
  if (account.balanceEventId && account.balanceEventId >= eventId) return null
  const later = account.settledSinceBalance.filter((s) => s.eventId > eventId)
  const debits = later.reduce((sum, s) => sum + BigInt(s.gross), ZERO)
  return {
    balanceEventId: eventId,
    balanceLedger: event.doc.ledger,
    settledSinceBalance: later,
    confirmedBalance: (balance - debits).toString(),
  }
}

/**
 * Applies an absolute balance event's patches, then releases the reserve of
 * settlements that balance already includes (`releaseIncludedReserves`).
 */
async function applyAbsolute(
  ctx: MutationCtx,
  account: Doc<'tabAccounts'>,
  event: IndexedEvent,
  balance: bigint,
  status: Partial<Doc<'tabAccounts'>>
): Promise<void> {
  const absolute = absoluteBalance(account, event, balance)
  await patchAccount(ctx, account, event.now, absolute, status)
  if (absolute) {
    await releaseIncludedReserves(ctx, account._id, {
      now: event.now,
      eventId: event.doc.eventId,
    })
  }
}

/** Patch for a `TabSettled` debit, or null when it is already counted. */
function balanceDebit(
  account: Doc<'tabAccounts'>,
  eventId: string,
  gross: bigint
): Partial<Doc<'tabAccounts'>> | null {
  if (account.balanceEventId && eventId < account.balanceEventId) return null
  if (account.settledSinceBalance.some((s) => s.eventId === eventId))
    return null
  const list = [
    ...account.settledSinceBalance,
    { eventId, gross: gross.toString() },
  ]
    .sort((a, b) => (a.eventId < b.eventId ? -1 : 1))
    .slice(-MAX_SETTLED_SINCE_BALANCE)
  return {
    settledSinceBalance: list,
    confirmedBalance: (BigInt(account.confirmedBalance) - gross).toString(),
  }
}

/** Patch for a status change, or an empty patch when a newer one is applied. */
function statusChange(
  account: Doc<'tabAccounts'>,
  eventId: string,
  status: Doc<'tabAccounts'>['status'],
  withdrawUnlockLedger?: number
): Partial<Doc<'tabAccounts'>> {
  if (account.statusEventId && account.statusEventId >= eventId) return {}
  return { status, statusEventId: eventId, withdrawUnlockLedger }
}

async function patchAccount(
  ctx: MutationCtx,
  account: Doc<'tabAccounts'>,
  now: number,
  ...patches: Array<Partial<Doc<'tabAccounts'>> | null>
): Promise<void> {
  const merged = Object.assign({}, ...patches.filter(Boolean))
  if (Object.keys(merged).length === 0) return
  await ctx.db.patch(account._id, { ...merged, updatedAt: now })
}

const deposited: ChainEventHandler = async (ctx, event) => {
  const reader = address(event.doc.topics[1], 'reader')
  const d = data(event)
  const balance = int(d.balance_after, 'balance_after')
  int(d.amount, 'amount')
  const account = await accountFor(ctx, event, reader, true)
  if (!account) return 'orphan'
  await applyAbsolute(
    ctx,
    account,
    event,
    balance,
    statusChange(account, event.doc.eventId, 'OPEN', undefined)
  )
  await unblockAccountPairs(ctx, account._id, event.now)
  return 'done'
}

const withdrawStarted: ChainEventHandler = async (ctx, event) => {
  const reader = address(event.doc.topics[1], 'reader')
  const d = data(event)
  const balance = int(d.balance, 'balance')
  const unlock = u32(d.unlock_ledger, 'unlock_ledger')
  const account = await accountFor(ctx, event, reader, false)
  if (!account) return 'orphan'
  await applyAbsolute(
    ctx,
    account,
    event,
    balance,
    statusChange(account, event.doc.eventId, 'CLOSING', unlock)
  )
  return 'done'
}

const withdrawCancelled: ChainEventHandler = async (ctx, event) => {
  const reader = address(event.doc.topics[1], 'reader')
  const balance = int(data(event).balance, 'balance')
  const account = await accountFor(ctx, event, reader, false)
  if (!account) return 'orphan'
  await applyAbsolute(
    ctx,
    account,
    event,
    balance,
    statusChange(account, event.doc.eventId, 'OPEN', undefined)
  )
  return 'done'
}

const withdrawn: ChainEventHandler = async (ctx, event) => {
  const reader = address(event.doc.topics[1], 'reader')
  int(data(event).amount, 'amount')
  const account = await accountFor(ctx, event, reader, false)
  if (!account) return 'orphan'
  await applyAbsolute(
    ctx,
    account,
    event,
    ZERO,
    statusChange(account, event.doc.eventId, 'CLOSED', undefined)
  )
  await resolveUnpaidPairs(ctx, account._id, event.doc.ledger, event.now)
  return 'done'
}

const keyRegistered: ChainEventHandler = async (ctx, event) => {
  const reader = address(event.doc.topics[1], 'reader')
  const d = data(event)
  const keyId = u32(d.key_id, 'key_id')
  const publicKey = hex32(d.public_key, 'public_key')
  const validUntil = u32(d.valid_until, 'valid_until')
  const spendLimit = int(d.spend_limit, 'spend_limit')
  const account = await accountFor(ctx, event, reader, true)
  if (!account) return 'orphan'
  const declared = account.pendingKeys.find((k) => k.publicKey === publicKey)
  const key = await tabKey(ctx, account._id, keyId)
  if (key?.registeredEventId) return 'done'
  if (key) {
    // `KeyRevoked` arrived first: keep the revocation and the lower expiry.
    await ctx.db.patch(key._id, {
      publicKey,
      spendLimit: spendLimit.toString(),
      validUntilLedger: Math.min(key.validUntilLedger, validUntil),
      extractable: declared?.extractable ?? key.extractable,
      registeredEventId: event.doc.eventId,
      updatedAt: event.now,
    })
  } else {
    await ctx.db.insert('tabSessionKeys', {
      network: event.doc.network,
      chainEpoch: event.doc.chainEpoch,
      tabAccountId: account._id,
      keyId,
      publicKey,
      validUntilLedger: validUntil,
      spendLimit: spendLimit.toString(),
      spentOnChain: '0',
      acceptedTotal: '0',
      revoked: false,
      extractable: declared?.extractable ?? false,
      registeredEventId: event.doc.eventId,
      createdAt: event.now,
      updatedAt: event.now,
    })
  }
  if (declared) {
    await ctx.db.patch(account._id, {
      pendingKeys: account.pendingKeys.filter((k) => k.publicKey !== publicKey),
      updatedAt: event.now,
    })
  }
  return 'done'
}

const keyRevoked: ChainEventHandler = async (ctx, event) => {
  const reader = address(event.doc.topics[1], 'reader')
  const d = data(event)
  const keyId = u32(d.key_id, 'key_id')
  const validUntil = u32(d.valid_until, 'valid_until')
  const account = await accountFor(ctx, event, reader, false)
  if (!account) return 'orphan'
  const key = await tabKey(ctx, account._id, keyId)
  if (key) {
    await ctx.db.patch(key._id, {
      revoked: true,
      validUntilLedger: Math.min(key.validUntilLedger, validUntil),
      updatedAt: event.now,
    })
    await updateKeySettleBy(
      ctx,
      account._id,
      keyId,
      Math.min(key.validUntilLedger, validUntil),
      event.now
    )
  } else {
    await ctx.db.insert('tabSessionKeys', {
      network: event.doc.network,
      chainEpoch: event.doc.chainEpoch,
      tabAccountId: account._id,
      keyId,
      validUntilLedger: validUntil,
      spendLimit: '0',
      spentOnChain: '0',
      acceptedTotal: '0',
      revoked: true,
      extractable: false,
      createdAt: event.now,
      updatedAt: event.now,
    })
  }
  return 'done'
}

const tabSettled: ChainEventHandler = async (ctx, event) => {
  const reader = address(event.doc.topics[1], 'reader')
  const writer = address(event.doc.topics[2], 'writer')
  const d = data(event)
  const keyId = u32(d.key_id, 'key_id')
  const cumulative = int(d.cumulative, 'cumulative')
  const paidAfter = int(d.paid_after, 'paid_after')
  const gross = int(d.gross, 'gross')
  int(d.fee, 'fee')
  hex32(d.receipts_root, 'receipts_root')
  const account = await accountFor(ctx, event, reader, false)
  if (!account) return 'orphan'
  await patchAccount(
    ctx,
    account,
    event.now,
    balanceDebit(account, event.doc.eventId, gross)
  )

  const voucher = await tabVoucher(ctx, account._id, keyId, writer)
  // A voucher accepted outside this deployment: the balance is still applied.
  if (!voucher) return 'orphan'
  await applyPairSettlement(ctx, {
    voucherId: voucher._id,
    paidAfter,
    cumulative,
    eventId: event.doc.eventId,
    indexedGross: gross,
    sourceLedger: event.doc.ledger,
    now: event.now,
  })
  return 'done'
}

/** `VoucherSkipped.reason` codes (section 3.9). */
export const SKIP_REASONS = {
  1: 'KEY_UNKNOWN',
  2: 'KEY_EXPIRED',
  3: 'STALE',
  4: 'SHORTFALL',
  5: 'NOT_ACCEPTED',
} as const

const voucherSkipped: ChainEventHandler = async (ctx, event) => {
  const reader = address(event.doc.topics[1], 'reader')
  const writer = address(event.doc.topics[2], 'writer')
  const d = data(event)
  const keyId = u32(d.key_id, 'key_id')
  const cumulative = int(d.cumulative, 'cumulative')
  const code = u32(d.reason, 'reason')
  const reason =
    SKIP_REASONS[code as keyof typeof SKIP_REASONS] ?? ('UNKNOWN' as const)
  const account = await accountFor(ctx, event, reader, false)
  if (!account) return 'orphan'
  const voucher = await tabVoucher(ctx, account._id, keyId, writer)
  if (!voucher) return 'orphan'
  if (!voucher.lastSkipEventId || voucher.lastSkipEventId < event.doc.eventId) {
    await ctx.db.patch(voucher._id, {
      lastSkipReason: reason,
      lastSkipEventId: event.doc.eventId,
      updatedAt: event.now,
    })
  }
  if (reason === 'SHORTFALL') {
    await applyPairPayment(ctx, voucher._id, {
      shortfallUpTo: cumulative,
      now: event.now,
    })
    // Nothing more can settle until the reader deposits.
    const fresh = (await ctx.db.get(account._id))!
    if (!fresh.balanceEventId || fresh.balanceEventId < event.doc.eventId) {
      await refreshSettleQueue(ctx, voucher._id, event.now, { block: true })
    }
  }
  if (reason === 'KEY_EXPIRED' || reason === 'KEY_UNKNOWN') {
    await resolveUnpaidPairs(ctx, account._id, event.doc.ledger, event.now)
  }
  return 'done'
}

const claimed: ChainEventHandler = async (ctx, event) => {
  const recipient = address(event.doc.topics[1], 'recipient')
  const amount = int(data(event).amount, 'amount')
  const token = readChainEnv().tokenContractId
  if (!token) return 'pending'
  const user = await uniqueVerifiedUser(ctx, recipient, passphrase())
  // The treasury, or an address no single user verified.
  if (!user) return 'orphan'
  await adjustBaseUnitEarnings(ctx, {
    userId: user._id,
    token,
    collected: amount,
    now: event.now,
  })
  return 'done'
}

/** Registered in `EVENT_HANDLERS` (`indexerStore.ts`). */
export const TAB_EVENT_HANDLERS: Readonly<Record<string, ChainEventHandler>> = {
  'tab:deposited': deposited,
  'tab:key_registered': keyRegistered,
  'tab:key_revoked': keyRevoked,
  'tab:tab_settled': tabSettled,
  'tab:voucher_skipped': voucherSkipped,
  'tab:claimed': claimed,
  'tab:withdraw_started': withdrawStarted,
  'tab:withdraw_cancelled': withdrawCancelled,
  'tab:withdrawn': withdrawn,
}
