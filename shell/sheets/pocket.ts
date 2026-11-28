import type { SheetDeclarations } from './types'

/**
 * The pocket package's lazily loaded sheets. Owned by that package. Any
 * surface may open them before the balance's code has loaded: the tip bar
 * opens 'add-money' with `{ need }` when the balance is short.
 */
export const sheets: SheetDeclarations = {
  'add-money': {
    title: (props: { need?: { display: string } } | null | undefined) =>
      props?.need ? `Add money to tip ${props.need.display}` : 'Add money',
    load: () => import('@/components/pocket/sheets/AddMoney'),
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
