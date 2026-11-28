import type { SheetDeclarations } from './types'

/**
 * The pocket package's lazily loaded sheets. Owned by that package. Any
 * surface may open them before the balance's code has loaded: the tip bar
 * opens 'add-money' with `{ need }` when the balance is short, and
 * 'quick-tips' when this device needs its approval.
 */
export const sheets: SheetDeclarations = {
  'add-money': {
    title: (props: { need?: { display: string } } | null | undefined) =>
      props?.need ? `Add money to tip ${props.need.display}` : 'Add money',
    load: () => import('@/components/pocket/sheets/AddMoney'),
  },
  // Setting up or renewing quick tips on this device: the tip control opens
  // it when the balance covers the tip and this device cannot tip without
  // the wallet, with `{ tip, verb, limitReached }`.
  'quick-tips': {
    title: (props: { verb?: 'set-up' | 'renew' } | null | undefined) =>
      props?.verb === 'renew'
        ? 'Renew quick tips on this device'
        : 'Set up quick tips on this device',
    load: () => import('@/components/pocket/sheets/QuickTips'),
  },
  // Turning quick tips off for one device, from Balance, with
  // `{ keyId, here }`.
  'quick-tips-off': {
    title: (props: { here?: boolean } | null | undefined) =>
      props?.here
        ? 'Turn off quick tips on this device'
        : 'Turn off quick tips on another device',
    load: () => import('@/components/pocket/sheets/TurnOffQuickTips'),
  },
  withdraw: {
    title: 'Withdraw',
    load: () => import('@/components/pocket/sheets/Withdraw'),
  },
  'pocket-exact-amount': {
    title: 'Exact amount',
    load: () => import('@/components/pocket/sheets/ExactAmount'),
  },
  'pocket-receipt': {
    title: 'Receipt',
    load: () => import('@/components/pocket/sheets/Receipt'),
  },
}
