/**
 * Prop types shared by the payment kit. The flow code (tips, tab, NFT) builds
 * these from Convex rows and wallet results; the components never fetch.
 */
export type {
  ClientStep,
  PaymentFailure,
  PaymentFlow,
  PaymentPhase,
  TabTipStatus,
  WalletGateState,
  WalletGateKind,
} from '@/lib/payments/ui-state'

export type PaymentTone = 'neutral' | 'info' | 'success' | 'warning' | 'danger'

/** A base-unit amount (stroops) as Convex stores it: a decimal string. */
export type BaseUnits = string

export type AmountLine = {
  /** Visible label, for example "To the author · 97.5%". */
  label: string
  amount: BaseUnits
}

export type NoticeAction =
  | { label?: string; onClick: () => void; href?: never }
  | { label?: string; href: string; onClick?: never }

export type TipsUnavailableReason =
  | 'unregistered'
  | 'pending'
  | 'payout_outdated'
  | 'splits'

export type PaymentNoticeProps = { className?: string } & (
  | { kind: 'paused' }
  | {
      kind: 'insufficient-balance'
      source: 'wallet'
      /** What the action needs, before the network fee. */
      needed?: BaseUnits
      available?: BaseUnits
      action?: NoticeAction
    }
  | {
      kind: 'insufficient-balance'
      source: 'tab'
      /** Confirmed balance minus tips still settling. */
      available?: BaseUnits
      action?: NoticeAction
    }
  | { kind: 'session-key-missing'; action?: NoticeAction }
  | { kind: 'session-key-expired'; action?: NoticeAction }
  | {
      kind: 'settlement-delayed'
      audience: 'reader' | 'writer'
      action?: NoticeAction
    }
  | {
      kind: 'tips-unavailable'
      reason: TipsUnavailableReason
      action?: NoticeAction
    }
  | {
      kind: 'withdrawal-pending'
      /** Already formatted for the reader, for example "Saturday 30 November". */
      unlockDate?: string
    }
  | { kind: 'withdrawal-ready'; amount?: BaseUnits; action?: NoticeAction }
  | { kind: 'network-busy' }
)
