/**
 * Which request the Add money sheet makes, what its primary button says,
 * and which other choice it offers. Pure rules, no React and no network.
 *
 * One signature in every case. Adding money with quick tips is the Tab
 * contract's `open_session` (a deposit and a new device key in one call),
 * which works on a first deposit and on a later one; money only is
 * `deposit`. Renewal is a new key: the old one keeps its own end.
 *
 * The default follows where the sheet was opened:
 * - from a tip, on a device that cannot quick tip: add and set up (or
 *   renew), with "Add money only" as the quiet choice;
 * - from the balance, on a device that cannot quick tip: money only, with
 *   an off-by-default switch to also set up quick tips;
 * - on a device that can quick tip (or whose key is not checked yet): add
 *   and renew, which also gives a fresh spending limit, with "Add money
 *   only" as the quiet choice;
 * - in a browser that cannot keep a key: money only, and no choice.
 */
import type { DeviceKeyView } from '@/lib/tab-ui/key-plan'

export type Entry = 'tip' | 'balance'

/** This device's quick-tip state, as the money layer reads it. */
export type DeviceKind = DeviceKeyView['kind']

export type QuickTipsVerb = 'set-up' | 'renew'

export type QuickTipsChoice =
  /** Quick tips are part of the request; the quiet action drops them. */
  | 'add-only'
  /** Money only by default; a switch adds quick tips. */
  | 'switch'
  /** No choice: this browser cannot keep a key. */
  | 'none'

export type AddMoneyPlan = {
  /** Whether the request includes quick tips before the reader chooses. */
  quickTipsByDefault: boolean
  verb: QuickTipsVerb
  choice: QuickTipsChoice
}

/** Kinds whose key works, or may work and only waits for a ledger read. */
const WORKING: readonly DeviceKind[] = ['ready', 'unchecked']

export function addMoneyPlan(input: {
  entry: Entry
  device: DeviceKind | null
}): AddMoneyPlan {
  const { entry, device } = input
  if (device === 'storage-unavailable')
    return { quickTipsByDefault: false, verb: 'set-up', choice: 'none' }
  if (device !== null && WORKING.includes(device))
    return { quickTipsByDefault: true, verb: 'renew', choice: 'add-only' }
  const verb: QuickTipsVerb = device === 'expired' ? 'renew' : 'set-up'
  if (entry === 'tip')
    return { quickTipsByDefault: true, verb, choice: 'add-only' }
  return { quickTipsByDefault: false, verb, choice: 'switch' }
}

/** The primary button: what the reader agrees to, with the amount. */
export function primaryLabel(
  amountShort: string,
  withQuickTips: boolean,
  verb: QuickTipsVerb
): string {
  if (!withQuickTips) return `Add ${amountShort}`
  return verb === 'renew'
    ? `Add ${amountShort} and renew quick tips`
    : `Add ${amountShort} and set up quick tips`
}

/** The quiet action that puts quick tips back after "Add money only". */
export function addQuickTipsAgainLabel(verb: QuickTipsVerb): string {
  return verb === 'renew' ? 'Also renew quick tips' : 'Also set up quick tips'
}

/**
 * The tip button's words when the balance covers the tip and this device
 * cannot quick tip, by device state; null when the button is the tip
 * itself (ready) or there is no button (checking, or no key can be kept).
 * `limitReached`: the server refused the last tip for the key's limit.
 */
export function tipButtonWords(
  device: DeviceKind,
  limitReached = false
): 'Renew to tip' | 'Set up to tip' | 'Finish setup to tip' | null {
  if (limitReached) return 'Renew to tip'
  switch (device) {
    case 'ready':
    case 'unchecked':
    case 'storage-unavailable':
      return null
    case 'expired':
      return 'Renew to tip'
    case 'pending':
      return 'Finish setup to tip'
    case 'none':
    case 'other-device':
    case 'gone':
    case 'revoked':
    case 'stopped':
      return 'Set up to tip'
  }
}

/**
 * The quick tips sheet's variant, from the device state: why it opened.
 * `limit` when the key's spending limit is used up.
 */
export type QuickTipsVariant =
  | 'set-up'
  | 'renew'
  | 'gone'
  | 'revoked'
  | 'stopped'
  | 'limit'
  | 'pending'

export function quickTipsVariant(
  device: DeviceKind,
  limitReached = false
): QuickTipsVariant {
  if (limitReached) return 'limit'
  switch (device) {
    case 'expired':
      return 'renew'
    case 'gone':
      return 'gone'
    case 'revoked':
      return 'revoked'
    case 'stopped':
      return 'stopped'
    case 'pending':
      return 'pending'
    default:
      return 'set-up'
  }
}
