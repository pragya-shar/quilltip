/**
 * Quick tips in Balance, from the server's list of approvals and this
 * browser's: this device's line, and one row per device that still has
 * quick tips. No device names exist in the code, so none is invented.
 */
import { acceptsUntilLedger, RENEW_WINDOW_LEDGERS } from '@/lib/tab-ui/key-plan'
import type { DeviceKey, LedgerClock, Reading } from './services'

const LEDGER_MS = 5_000

/** The ledger now, from the indexer's latest and the time since. */
export function ledgerNow(clock: LedgerClock, now: number): number {
  return (
    clock.sequence + Math.max(0, Math.floor((now - clock.closedAt) / LEDGER_MS))
  )
}

export type DeviceRow = {
  key: DeviceKey
  /** Off in Quilltip; the wallet has not recorded it on the network. */
  unconfirmed: boolean
}

export type ThisDevice =
  | { kind: 'ready'; validUntilLedger: number; renewSoon: boolean }
  | { kind: 'needs-setup'; verb: 'set-up' | 'renew' }
  | { kind: 'checking' }
  | { kind: 'unavailable' }

export function thisDevice(reading: Reading, now: number): ThisDevice | null {
  const device = reading.device
  if (device === null) return null
  if (device === 'unchecked') return { kind: 'checking' }
  if (device === 'storage-unavailable') return { kind: 'unavailable' }
  if (device === 'ready') {
    const key = reading.keys.find((k) => k.keyId === reading.deviceKeyId)
    if (!key || !reading.ledger) return { kind: 'checking' }
    const left =
      acceptsUntilLedger(key.validUntilLedger) - ledgerNow(reading.ledger, now)
    return {
      kind: 'ready',
      validUntilLedger: key.validUntilLedger,
      renewSoon: left <= RENEW_WINDOW_LEDGERS,
    }
  }
  return {
    kind: 'needs-setup',
    verb: device === 'expired' ? 'renew' : 'set-up',
  }
}

/**
 * Devices that still have quick tips, this one first, then the newest.
 * A key turned off in Quilltip whose end on the network has not been
 * lowered by the wallet yet stays, marked unconfirmed, until the wallet
 * confirms it or it ends.
 */
export function quickTipsRows(reading: Reading, now: number): DeviceRow[] {
  if (!reading.ledger) return []
  const current = ledgerNow(reading.ledger, now)
  return reading.keys
    .filter((k) => k.publicKey !== null)
    .filter((k) =>
      k.revoked
        ? k.validUntilLedger > current
        : acceptsUntilLedger(k.validUntilLedger) > current
    )
    .map((key) => ({ key, unconfirmed: key.revoked }))
    .sort(
      (a, b) =>
        Number(b.key.here) - Number(a.key.here) || b.key.keyId - a.key.keyId
    )
}
