/**
 * Sample outputs of `formatMoney` (`text`) and `spokenMoney` (`spoken`), the
 * contract between this layer and any component that parses or speaks its
 * text (for example a figure that styles the extra decimals, or a row label
 * for a screen reader). Both sides' tests import this list, so neither
 * drifts. Not imported by the app.
 */
import type { MoneyFormat } from './money'

export const MONEY_TEXT_SAMPLES: {
  name: string
  cents: number
  format?: MoneyFormat
  text: string
  spoken: string
}[] = [
  { name: 'plain', cents: 100, text: '$1.00', spoken: '1 dollar' },
  {
    name: 'thousands',
    cents: 123456.78,
    text: '$1,234.5678',
    spoken: '1,234 dollars 56.78',
  },
  { name: 'six decimals', cents: 9.75, text: '$0.0975', spoken: '9.75 cents' },
  {
    name: 'five decimals',
    cents: 4.875,
    text: '$0.04875',
    spoken: '4.875 cents',
  },
  { name: 'cents', cents: 50, text: '$0.50', spoken: '50 cents' },
  { name: 'ten cents', cents: 10, text: '$0.10', spoken: '10 cents' },
  { name: 'one cent', cents: 1, text: '$0.01', spoken: '1 cent' },
  {
    name: 'dollars and cents',
    cents: 1840,
    text: '$18.40',
    spoken: '18 dollars 40',
  },
  {
    name: 'signed minus',
    cents: 100,
    format: { sign: 'minus' },
    text: '−$1.00',
    spoken: 'minus 1 dollar',
  },
  {
    name: 'signed plus',
    cents: 195,
    format: { sign: 'plus' },
    text: '+$1.95',
    spoken: 'plus 1 dollar 95',
  },
  {
    name: 'signed plus share',
    cents: 9.75,
    format: { sign: 'plus' },
    text: '+$0.0975',
    spoken: 'plus 9.75 cents',
  },
  {
    name: 'converted',
    cents: 1840,
    format: { converted: true },
    text: '≈ $18.40',
    spoken: 'about 18 dollars 40',
  },
  {
    name: 'converted plain',
    cents: 1840,
    format: { converted: true, convertedStyle: 'plain' },
    text: '$18.40',
    spoken: 'about 18 dollars 40',
  },
  { name: 'zero', cents: 0, text: '$0.00', spoken: '0 cents' },
  // The tip button and the amount choices.
  {
    name: 'short whole',
    cents: 100,
    format: { short: true },
    text: '$1',
    spoken: '1 dollar',
  },
  {
    name: 'short cents',
    cents: 50,
    format: { short: true },
    text: '$0.50',
    spoken: '50 cents',
  },
  {
    name: 'short dollars and cents',
    cents: 250,
    format: { short: true },
    text: '$2.50',
    spoken: '2 dollars 50',
  },
  // Below the sixth decimal: zero; the token amount is on the item.
  { name: 'dust', cents: 0.00001, text: '$0.00', spoken: '0 cents' },
]
