/**
 * Whether the reader can tip from the tab here, and if not, why
 * (05-flows-and-admin.md, section 5.6; payment-states.md, matrix note 7).
 * Checked before anything is prepared; Convex still decides on prepare.
 */
import type { WalletGateState } from '@/lib/payments/ui-state'
import type { DeviceKeyView } from './key-plan'
import type { TabStatusView } from './tab-status'
import type { MyTab, MyTabTips, WalletAccess } from './types'

export type TabTipAvailability =
  | { kind: 'loading' }
  | { kind: 'ready'; keyId: number; free: string }
  /** Payments v2 or the Tab contract is off on this deployment. */
  | { kind: 'unavailable' }
  /** Settlement is switched off, so Convex accepts no tab tips. */
  | { kind: 'settlement-off' }
  /** The article pays co-authors: a tab tip pays exactly one writer. */
  | { kind: 'splits' }
  /** Signed out, or no verified wallet (a tab needs one). */
  | { kind: 'gate'; gate: WalletGateState }
  | { kind: 'tab-none' }
  | { kind: 'tab-closing' }
  | { kind: 'key'; device: Exclude<DeviceKeyView, { kind: 'ready' }> }

export type AvailabilityInput = {
  status: TabStatusView
  access: Pick<WalletAccess, 'gate' | 'address'>
  device: DeviceKeyView | undefined
  tab: MyTab | null | undefined
  activity: MyTabTips | null | undefined
  /** Recipients Core pays for the article; more than one means splits. */
  recipientCount?: number | null
}

export function tabTipAvailability(
  input: AvailabilityInput
): TabTipAvailability {
  const { status, access, device, tab, activity } = input
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
  if (status.kind === 'loading') return { kind: 'loading' }
  if (activity && !activity.settlementEnabled) return { kind: 'settlement-off' }
  if (status.kind === 'none' || status.kind === 'closed' || !tab) {
    return { kind: 'tab-none' }
  }
  if (status.kind === 'closing') return { kind: 'tab-closing' }
  if (!device) return { kind: 'loading' }
  if (device.kind !== 'ready') return { kind: 'key', device }
  return { kind: 'ready', keyId: device.keyId, free: tab.available }
}
