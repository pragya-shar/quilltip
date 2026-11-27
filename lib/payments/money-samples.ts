/**
 * Sample outputs of `formatMoney`, the contract between this layer and any
 * component that parses its text (for example a figure that styles the
 * extra decimals). Both sides' tests import this list, so neither drifts.
 * Not imported by the app.
 */
import type { MoneyFormat } from './money'

export const MONEY_TEXT_SAMPLES: {
  name: string
  cents: number
  format?: MoneyFormat
  text: string
}[] = [
  { name: 'plain', cents: 100, text: '$1.00' },
  { name: 'thousands', cents: 123456.78, text: '$1,234.5678' },
  { name: 'six decimals', cents: 9.75, text: '$0.0975' },
  { name: 'five decimals', cents: 4.875, text: '$0.04875' },
  {
    name: 'signed minus',
    cents: 100,
    format: { sign: 'minus' },
    text: '−$1.00',
  },
  { name: 'signed plus', cents: 195, format: { sign: 'plus' }, text: '+$1.95' },
  {
    name: 'converted',
    cents: 1840,
    format: { converted: true },
    text: '≈ $18.40',
  },
  {
    name: 'converted plain',
    cents: 1840,
    format: { converted: true, convertedStyle: 'plain' },
    text: '$18.40',
  },
  { name: 'zero', cents: 0, text: '$0.00' },
  // Below the sixth decimal: zero; the token amount is on the item.
  { name: 'dust', cents: 0.00001, text: '$0.00' },
]
