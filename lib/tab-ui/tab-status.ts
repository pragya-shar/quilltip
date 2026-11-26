/**
 * The reader's tab as the screens show it: status, the three balance
 * figures, the withdrawal unlock estimate, and the standing conditions that
 * apply to the whole tab (05-flows-and-admin.md, sections 5.5 and 5.9;
 * docs/design-system/payment-states.md, "When to show").
 */
import { estimateLedgerTime, formatDay } from '@/lib/payments/format'
import { isSettlementDelayed } from '@/lib/payments/ui-state'
import { DAY_LEDGERS } from '@/lib/stellar/v2/tab'
import type { ChainConfigView, LedgerClock, MyTab, MyTabTips } from './types'

/** `WITHDRAW_DELAY` of the Tab contract (03-tab-contract.md, section 3.1). */
export const WITHDRAW_DELAY_LEDGERS = 3 * DAY_LEDGERS

export type TabStatusView =
  | { kind: 'loading' }
  /** Payments v2 or the Tab contract is not configured on this deployment. */
  | { kind: 'unavailable' }
  /** No tab yet (or no verified address, which a tab needs). */
  | { kind: 'none' }
  | { kind: 'open' }
  | {
      kind: 'closing'
      unlockLedger: number | null
      /** The unlock ledger has passed, by the latest ledger read. */
      ready: boolean
      /** Formatted estimate, for example "Monday 30 November". */
      unlocksAround: string | null
      unlocksAt: Date | null
    }
  | { kind: 'closed' }

export function tabStatusView(input: {
  tab: MyTab | null | undefined
  chainConfig: ChainConfigView | undefined
  clock: LedgerClock | null
  locale?: string
}): TabStatusView {
  const { tab, chainConfig, clock } = input
  if (chainConfig === undefined || tab === undefined) return { kind: 'loading' }
  if (!chainConfig.v2Enabled || !chainConfig.tabContractId) {
    return { kind: 'unavailable' }
  }
  if (tab === null) return { kind: 'none' }
  if (tab.status === 'OPEN') return { kind: 'open' }
  if (tab.status === 'CLOSED') return { kind: 'closed' }
  const unlockLedger = tab.withdrawUnlockLedger
  const unlocksAt =
    unlockLedger !== null && clock
      ? estimateLedgerTime(unlockLedger, clock)
      : null
  return {
    kind: 'closing',
    unlockLedger,
    ready:
      unlockLedger !== null && clock !== null && clock.sequence >= unlockLedger,
    unlocksAt,
    unlocksAround: unlocksAt ? formatDay(unlocksAt, input.locale) : null,
  }
}

/**
 * The date a withdrawal started now would unlock, for the statement before
 * the reader closes the tab. An estimate from the ledger clock.
 */
export function closeUnlockEstimate(
  clock: LedgerClock | null,
  locale?: string
): { at: Date; day: string } | null {
  if (!clock) return null
  const at = estimateLedgerTime(clock.sequence + WITHDRAW_DELAY_LEDGERS, clock)
  return { at, day: formatDay(at, locale) }
}

export type TabBalances = {
  /** On chain, from indexed events. */
  confirmed: string
  /** Accepted tips not settled yet. */
  committed: string
  /** `confirmed − committed`: what quick tips can still use. */
  free: string
}

export function tabBalances(tab: MyTab): TabBalances {
  return {
    confirmed: tab.confirmedBalance,
    committed: tab.outstanding,
    free: BigInt(tab.available) > BigInt(0) ? tab.available : '0',
  }
}

export type SettlementHealth =
  | { kind: 'ok' }
  /** `SETTLEMENT_ENABLED` is off: accepted tips wait, new ones are refused. */
  | { kind: 'off' }
  /** Late by the settler's own rules (03, sections 3.7 and 3.8). */
  | { kind: 'delayed' }

/**
 * Settlement health from the receipt activity. Normal settlement (a tip
 * younger than the due time plus two settler runs) is never "delayed".
 */
export function settlementHealth(
  activity:
    | Pick<
        MyTabTips,
        'settlementEnabled' | 'oldestUnsettledAt' | 'settleWindowEndsSoon'
      >
    | null
    | undefined,
  now: number
): SettlementHealth {
  if (!activity) return { kind: 'ok' }
  const waiting = activity.oldestUnsettledAt !== null
  if (!activity.settlementEnabled)
    return waiting ? { kind: 'off' } : { kind: 'ok' }
  if (
    isSettlementDelayed(activity.oldestUnsettledAt, now) ||
    (waiting && activity.settleWindowEndsSoon)
  ) {
    return { kind: 'delayed' }
  }
  return { kind: 'ok' }
}

/** Tab operations the Tab contract's pause blocks (I-27). */
export function pauseBlocks(
  flow:
    | 'tab-open'
    | 'tab-top-up'
    | 'tab-new-key'
    | 'tab-revoke-key'
    | 'tab-close'
    | 'tab-withdraw'
    | 'collect'
): boolean {
  return flow === 'tab-open' || flow === 'tab-top-up' || flow === 'tab-new-key'
}

export function tabPaused(chainConfig: ChainConfigView | undefined): boolean {
  const paused = chainConfig?.paused as { tab?: boolean } | undefined
  return paused?.tab === true
}
