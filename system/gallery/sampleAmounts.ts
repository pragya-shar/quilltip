import type { MoneyValue } from '../money/figure'

/** The quick tip amounts of the samples: their own module, so the sample
 * reading page loads them without the gallery's other sample data. */
export const amounts: MoneyValue[] = [
  { cents: 100, display: '$1' },
  { cents: 200, display: '$2' },
  { cents: 300, display: '$3' },
  { cents: 500, display: '$5' },
  { cents: 1000, display: '$10' },
]
