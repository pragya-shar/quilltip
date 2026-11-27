/**
 * Session key parameters and the device key state shown on the tab screens
 * (03-tab-contract.md, section 3.5; lib/stellar/v2/tab/README.md, "How the
 * UI presents each state").
 */
import {
  ACCEPT_MARGIN_LEDGERS,
  DAY_LEDGERS,
  tabKeyState,
  type LocalSessionKeyInfo,
  type ServerSessionKey,
} from '@/lib/stellar/v2/tab'
import { minBig } from './amounts'

/** App default key lifetime: 7 days (spec 3.5, item 2). */
export const DEFAULT_KEY_LIFETIME_LEDGERS = 7 * DAY_LEDGERS
/** Default `spend_limit` cap: 50 XLM (spec 3.5, item 2). */
export const DEFAULT_SPEND_LIMIT_CAP = BigInt(500_000_000)
/** Offer renewal this long before Convex stops accepting under the key. */
export const RENEW_WINDOW_LEDGERS = 2 * DAY_LEDGERS

/**
 * `valid_until` and `spend_limit` for a new key: 7 days from the latest
 * ledger, and `min(tab balance after this call, 50 XLM)`. A tab with no
 * balance yet gets the cap, since `spend_limit` must be above zero.
 */
export function keyPlan(input: {
  latestLedger: number
  tabBalanceAfter: string
}): { validUntil: number; spendLimit: string } {
  const balance = BigInt(input.tabBalanceAfter)
  const spendLimit =
    balance > BigInt(0)
      ? minBig(balance, DEFAULT_SPEND_LIMIT_CAP)
      : DEFAULT_SPEND_LIMIT_CAP
  return {
    validUntil: input.latestLedger + DEFAULT_KEY_LIFETIME_LEDGERS,
    spendLimit: spendLimit.toString(),
  }
}

/** The last ledger at which Convex accepts tips under a key. */
export function acceptsUntilLedger(validUntilLedger: number): number {
  return validUntilLedger - ACCEPT_MARGIN_LEDGERS
}

export type DeviceKeyView =
  /** This browser holds an active key. */
  | {
      kind: 'ready'
      keyId: number
      /** Convex stops accepting under it within 2 days: offer renewal. */
      renewSoon: boolean
    }
  /** A key was generated here and its registration is not confirmed yet. */
  | { kind: 'pending' }
  /** No key anywhere. */
  | { kind: 'none' }
  /** An active key exists, registered from another browser or device. */
  | { kind: 'other-device'; keyId: number }
  /** This browser had the active key and lost it (cleared or evicted). */
  | { kind: 'gone'; keyId: number }
  | { kind: 'expired'; keyId: number }
  | { kind: 'revoked'; keyId: number }
  /** This browser stopped the key after a ledger mismatch. */
  | { kind: 'stopped'; keyId: number }
  /** IndexedDB is blocked or missing, so no key can be held here. */
  | { kind: 'storage-unavailable' }
  /**
   * This browser holds an active key, but the latest ledger could not be
   * read from Stellar RPC, so its expiry cannot be checked.
   */
  | { kind: 'unchecked'; keyId: number }

/**
 * The device key view from `getMyTab().keys`, this browser's keys and the
 * key ids this browser has bound before (`seenKeyIds`, kept apart from the
 * key store so a lost key can be told from another device's key).
 */
export function deviceKeyView(input: {
  serverKeys: ServerSessionKey[]
  localKeys: LocalSessionKeyInfo[] | null
  /** Null when the latest ledger could not be read. */
  currentLedger: number | null
  seenKeyIds: readonly number[]
}): DeviceKeyView {
  if (input.localKeys === null) return { kind: 'storage-unavailable' }
  const { status, keyId } = tabKeyState({
    serverKeys: input.serverKeys,
    localKeys: input.localKeys,
    // Without a ledger no key reads as expired: "ready" becomes unchecked.
    currentLedger: input.currentLedger ?? 0,
  })
  switch (status) {
    case 'ready': {
      if (input.currentLedger === null)
        return { kind: 'unchecked', keyId: keyId! }
      const key = input.serverKeys.find((k) => k.keyId === keyId)!
      return {
        kind: 'ready',
        keyId: keyId!,
        renewSoon:
          acceptsUntilLedger(key.validUntilLedger) - input.currentLedger <=
          RENEW_WINDOW_LEDGERS,
      }
    }
    case 'pending':
      return { kind: 'pending' }
    case 'none':
      return { kind: 'none' }
    case 'missing':
      return input.seenKeyIds.includes(keyId!)
        ? { kind: 'gone', keyId: keyId! }
        : { kind: 'other-device', keyId: keyId! }
    case 'expired':
      return { kind: 'expired', keyId: keyId! }
    case 'revoked':
      return { kind: 'revoked', keyId: keyId! }
    case 'unusable':
      return { kind: 'stopped', keyId: keyId! }
  }
}

/** True when the device can tip from the tab without a wallet prompt. */
export function canQuickTip(
  view: DeviceKeyView
): view is Extract<DeviceKeyView, { kind: 'ready' }> {
  return view.kind === 'ready'
}

/** The on-chain key ids this browser holds, whatever their state. */
export function localKeyIds(
  localKeys: LocalSessionKeyInfo[] | null | undefined
): number[] {
  return (localKeys ?? []).flatMap((k) => k.keyIds)
}

/** The pending key to reuse after a failed or cancelled wallet step. */
export function pendingLocalKey(
  localKeys: LocalSessionKeyInfo[]
): LocalSessionKeyInfo | null {
  return (
    [...localKeys]
      .filter((k) => k.keyIds.length === 0 && !k.unusable)
      .sort((a, b) => b.createdAt - a.createdAt)[0] ?? null
  )
}
