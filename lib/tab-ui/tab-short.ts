/**
 * A short tab (#617, #620, #643): the tips still settling exceed the tab
 * balance, so nothing more settles until the reader tops up. The tab notice,
 * the recent tab tips and the wallet receipts read it the same way. Kept
 * apart from `tab-status` so the wallet page loads no Stellar code.
 */
import { phaseFromTabTip, type PaymentPhase } from '@/lib/payments/ui-state'
import type { MyTab } from './types'

/**
 * How far the tips still settling exceed the tab balance, or null when the
 * tab covers them. `available` goes below 0 only when the balance fell under
 * what was already accepted, for example after a settlement paid outside
 * the app; nothing more settles and no quick tip is accepted until the
 * reader tops up.
 */
export function tabShortBy(tab: Pick<MyTab, 'available'>): string | null {
  const free = BigInt(tab.available)
  return free < BigInt(0) ? (-free).toString() : null
}

/** An open tab that is short: what the tab page's notice shows for. */
export function tabIsShort(
  tab: Pick<MyTab, 'status' | 'available'> | null | undefined
): boolean {
  return !!tab && tab.status === 'OPEN' && tabShortBy(tab) !== null
}

/**
 * A tab tip's phase as its reader sees it. An accepted tip on a short tab
 * waits for a top-up, like one a settlement attempt has parked (SHORTFALL),
 * so it reads "Waiting for balance", with no amount or time. Amounts and
 * receipt states do not change.
 */
export function readerTabTipPhase(
  status: string,
  tabShort: boolean
): PaymentPhase {
  const phase = phaseFromTabTip(status)
  return phase === 'accepted' && tabShort ? 'shortfall' : phase
}
