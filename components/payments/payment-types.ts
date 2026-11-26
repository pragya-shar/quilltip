/**
 * Prop types shared by the payment kit. The flow code (tips, tab, NFT) builds
 * these from Convex rows and wallet results; the components never fetch.
 */
export type {
  BatchRow,
  ChainRecord,
  ClientStep,
  PaymentFlow,
  PaymentPhase,
  ProgressSource,
  TabOperation,
  TabSnapshot,
  TipsUnavailableReason,
  WalletGateState,
  WalletGateKind,
} from '@/lib/payments/ui-state'
export type { PaymentFailure } from '@/lib/payments/failures'

import type {
  PaymentPhase,
  TipsUnavailableReason,
} from '@/lib/payments/ui-state'

export type PaymentTone = 'neutral' | 'info' | 'success' | 'warning' | 'danger'

/** A base-unit amount (stroops) as Convex stores it: a decimal string. */
export type BaseUnits = string

export type AmountLine = {
  /** Visible label, for example "To the author" or an article title. */
  label: string
  amount: BaseUnits
  /** A basket row's own state, for example `sent-to-registered`. */
  status?: PaymentPhase
  /** One short line under the row, for example why it cannot be sent. */
  note?: string
}

export type NoticeAction = (
  | { label?: string; onClick: () => void; href?: never }
  | { label?: string; href: string; onClick?: never }
) & {
  /** Overrides the notice's default emphasis. */
  emphasis?: 'primary' | 'secondary'
}

export type PaymentNoticeProps = {
  className?: string
  /**
   * The notice appears because of something the user just did (a refused
   * prepare, a pause hit while starting). Announced once after mount. Leave
   * it off for a condition that is there when the page loads.
   */
  announce?: boolean
} & (
  | { kind: 'paused'; audience?: 'reader' | 'writer' }
  | {
      kind: 'insufficient-balance'
      source: 'wallet'
      /** What the action needs, before the network fee. */
      needed?: BaseUnits
      /** What the wallet can spend: balance minus the account reserve. */
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
  | { kind: 'session-key-none'; action?: NoticeAction }
  | { kind: 'session-key-missing'; action?: NoticeAction }
  | { kind: 'session-key-expired'; action?: NoticeAction }
  | { kind: 'key-limit'; action?: NoticeAction }
  | { kind: 'daily-limit'; action?: NoticeAction }
  | { kind: 'tab-none'; action?: NoticeAction }
  | { kind: 'tab-closing'; action?: NoticeAction }
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
  | { kind: 'basket-item-unavailable'; action?: NoticeAction }
  | {
      kind: 'withdrawal-pending'
      /** Formatted with `formatDay(estimateLedgerTime(...))`. */
      unlockDate?: string
    }
  | { kind: 'withdrawal-ready'; amount?: BaseUnits; action?: NoticeAction }
  | { kind: 'close-tab-warning'; action?: NoticeAction }
  | {
      kind: 'nft-threshold'
      /** Tips so far and the mint threshold, from the article's totals. */
      tipped: BaseUnits
      threshold: BaseUnits
    }
  | { kind: 'network-busy' }
  /** A Convex refusal with no notice of its own (`refusalFromTabError`). */
  | { kind: 'refused'; copy: { title: string; detail: string } }
)
