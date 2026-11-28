/**
 * Whether the reader can tip from the tab here, and if not, why
 * (05-flows-and-admin.md, section 5.6; payment-states.md, matrix note 7).
 * Checked before anything is prepared; Convex still decides on prepare.
 */
import type { WalletGateState } from '@/lib/payments/ui-state'
import type { DeviceKeyView } from './key-plan'
import { tabShortBy, type TabStatusView } from './tab-status'
import type { MyTab, TabSettlementView, WalletAccess } from './types'

export type TabTipAvailability =
  | { kind: 'loading' }
  | { kind: 'ready'; keyId: number; free: string }
  /** Payments v2 or the Tab contract is off on this deployment. */
  | { kind: 'unavailable' }
  /**
   * Convex accepts no tab tips: settlement is switched off, or its keys or
   * the Tab's state are not ready (`tabReady`).
   */
  | { kind: 'settlement-off' }
  /** The article pays co-authors: a tab tip pays exactly one writer. */
  | { kind: 'splits' }
  /** Signed out, or no verified wallet (a tab needs one). */
  | { kind: 'gate'; gate: WalletGateState }
  | { kind: 'tab-none' }
  | { kind: 'tab-closing' }
  /**
   * Tips already sent exceed the tab balance by `short`: no quick tip is
   * accepted until the reader tops up.
   */
  | { kind: 'tab-short'; short: string }
  | { kind: 'key'; device: Exclude<DeviceKeyView, { kind: 'ready' }> }

export type AvailabilityInput = {
  status: TabStatusView
  access: Pick<WalletAccess, 'gate' | 'address'>
  device: DeviceKeyView | undefined
  tab: MyTab | null | undefined
  /** `getTabSettlement`; undefined while it loads. */
  settlement: TabSettlementView | undefined
  /** Recipients Core pays for the article; more than one means splits. */
  recipientCount?: number | null
}

export function tabTipAvailability(
  input: AvailabilityInput
): TabTipAvailability {
  const { status, access, device, tab } = input
  if (typeof input.recipientCount === 'number' && input.recipientCount > 1) {
    return { kind: 'splits' }
  }
  if (status.kind === 'unavailable') return { kind: 'unavailable' }
  if (access.gate.kind === 'checking') return { kind: 'loading' }
  if (!access.address) {
    // A quick tip needs no wallet connection, only a verified address.
    if (access.gate.kind === 'signed-out')
      return { kind: 'gate', gate: access.gate }
    return {
      kind: 'gate',
      gate: {
        kind: 'unverified',
        ...(access.gate.kind === 'unverified' && access.gate.address
          ? { address: access.gate.address }
          : {}),
      },
    }
  }
  if (status.kind === 'loading' || input.settlement === undefined)
    return { kind: 'loading' }
  // Settlement is off, or its keys or the Tab's state are not ready
  // (`tabReady`): say so before anything is prepared, not as a refusal after.
  if (
    !input.settlement.settlementEnabled ||
    input.settlement.tabReady === false
  ) {
    return { kind: 'settlement-off' }
  }
  if (status.kind === 'none' || status.kind === 'closed' || !tab) {
    return { kind: 'tab-none' }
  }
  if (status.kind === 'closing') return { kind: 'tab-closing' }
  const short = tabShortBy(tab)
  if (short) return { kind: 'tab-short', short }
  if (!device) return { kind: 'loading' }
  if (device.kind !== 'ready') return { kind: 'key', device }
  return { kind: 'ready', keyId: device.keyId, free: tab.available }
}
