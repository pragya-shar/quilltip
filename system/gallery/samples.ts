import type { MoneyValue } from '../money/figure'

/**
 * Sample data for the gallery and its tests. Display strings are written as
 * the money layer writes them (lib/payments/money.ts): exact "$18.40",
 * converted "≈ $17.28", under a cent "<$0.01", whole-dollar labels "$1".
 */
export const money = {
  balance: { cents: 1840, display: '$18.40' },
  large: { cents: 123456789, display: '$1,234,567.89' },
  approx: { cents: 1728, display: '≈ $17.28' },
  belowCent: { cents: 0.4, display: '<$0.01' },
  zero: { cents: 0, display: '$0.00' },
  earnings: { cents: 31275, display: '$312.75' },
  one: { cents: 100, display: '$1' },
  three: { cents: 300, display: '$3' },
  tipRow: { cents: 300, display: '$3.00' },
  added: { cents: 2000, display: '$20.00' },
  received: { cents: 98, display: '$0.98' },
} satisfies Record<string, MoneyValue>

export const amounts: MoneyValue[] = [
  { cents: 100, display: '$1' },
  { cents: 200, display: '$2' },
  { cents: 300, display: '$3' },
  { cents: 500, display: '$5' },
  { cents: 1000, display: '$10' },
]

/** Worst cases the components must survive (break-ui). */
export const worst = {
  longName: 'Maximilian Alexander Featherstonehaugh-Montgomery',
  unbroken: 'averyveryverylongunbrokenhandlewithoutanyspaces@example.com',
  rtlName: 'نور حداد',
  passage:
    'She wrote down every coin she ever gave away. Not to remember the money, but to remember the people.',
}
