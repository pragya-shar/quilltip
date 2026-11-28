/**
 * The reading from the server's balance session, and the operations the
 * sheets ask for. Pure, so a test pins where every figure comes from: the
 * price that converts dollars to XLM, and caps a device approval at $50,
 * is the server's cached price (`session.prices`), never another source.
 */
import { depositStroops } from './amounts'
import type { DeviceKey, Operation, Reading } from './services'
import type { DeviceKind } from './plan'

/** The parts of `api.balance.session` the sheets read. */
export type SessionShape = {
  userId: string
  status: 'none' | 'open' | 'closing'
  tokens: { confirmed: string; available: string }[]
  prices: { token: string; usd: number; at: number }[]
  settlement: { enabled: boolean }
  ledger: { sequence: number; closedAt: number } | null
}

export function readingFromSession(
  session: SessionShape,
  input: {
    address: string | null
    keys: DeviceKey[]
    device: DeviceKind | null
    deviceKeyId: number | null
  }
): Reading {
  const quote = session.prices.find((p) => p.token === 'xlm') ?? null
  return {
    userId: session.userId,
    address: input.address,
    status: session.status,
    confirmed: session.tokens[0]?.confirmed ?? '0',
    available: session.tokens[0]?.available ?? '0',
    priceUsd: quote?.usd ?? null,
    priceAt: quote?.at ?? null,
    accepting: session.settlement.enabled,
    keys: input.keys,
    device: input.address ? input.device : null,
    deviceKeyId: input.deviceKeyId,
    ledger: session.ledger,
  }
}

/** Adding `cents`, with or without quick tips, at the reading's price. */
export function addOperation(
  reading: Pick<Reading, 'priceUsd' | 'confirmed'>,
  cents: number,
  withQuickTips: boolean
): Extract<Operation, { kind: 'add' }> | null {
  if (!reading.priceUsd) return null
  const amount = depositStroops(cents, reading.priceUsd)
  return {
    kind: 'add',
    amount,
    withQuickTips,
    balanceAfter: (BigInt(reading.confirmed) + BigInt(amount)).toString(),
    priceUsd: reading.priceUsd,
  }
}

/** Setting up or renewing quick tips alone, at the reading's price. */
export function quickTipsOperation(
  reading: Pick<Reading, 'priceUsd' | 'confirmed'>
): Extract<Operation, { kind: 'quick-tips' }> {
  return {
    kind: 'quick-tips',
    balance: reading.confirmed,
    priceUsd: reading.priceUsd,
  }
}
