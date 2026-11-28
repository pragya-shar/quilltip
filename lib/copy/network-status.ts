import { STELLAR_CONFIG } from '@/lib/stellar/config'

type SupportedNetwork = 'TESTNET' | 'MAINNET'

function getNetwork(): SupportedNetwork {
  return STELLAR_CONFIG.NETWORK === 'MAINNET' ? 'MAINNET' : 'TESTNET'
}

export function networkLabelLowercase(): 'testnet' | 'mainnet' {
  return getNetwork() === 'MAINNET' ? 'mainnet' : 'testnet'
}

export function practiceFundsNote(): string {
  if (getNetwork() === 'MAINNET') {
    return 'Quilltip runs on Stellar mainnet. Tips use real funds.'
  }
  return 'Quilltip runs on Stellar testnet. Tips use free test XLM for practice—not real money.'
}

export function testnetBadgeLabel(): string {
  return getNetwork() === 'MAINNET'
    ? 'Mainnet'
    : 'Testnet — practice funds only'
}

// Backwards-compatible exports (existing imports across the app).
export const TESTNET_PRACTICE_NOTE = practiceFundsNote()

export const MAINNET_COMING_NOTE =
  'We are working toward a mainnet launch where tips will use real funds. Until then, everything on Quilltip is testnet practice.'

/** True while tips run on Stellar testnet and amounts have no real value. */
export function isTestnetValue(): boolean {
  return getNetwork() !== 'MAINNET'
}

/** Heading for any earnings figure, for example "Earned (testnet)". */
export function earningsLabel(base = 'Earned'): string {
  return isTestnetValue() ? `${base} (testnet)` : base
}

/** Secondary note for USD estimates of testnet amounts. */
export const TESTNET_NO_VALUE_NOTE = 'testnet, no real value'

/**
 * Formats stroops as an XLM amount, rounded half up to at most
 * `maxDecimals` places (7 keeps full stroop precision).
 */
export function formatXlmFromStroops(stroops: string, maxDecimals = 7): string {
  const decimals = Math.min(Math.max(Math.trunc(maxDecimals), 0), 7)
  const raw = /^\d+$/.test(stroops) ? BigInt(stroops) : BigInt(0)
  const step = BigInt(10) ** BigInt(7 - decimals)
  const value = ((raw + step / BigInt(2)) / step) * step
  const whole = value / BigInt(10_000_000)
  const fraction = (value % BigInt(10_000_000))
    .toString()
    .padStart(7, '0')
    .slice(0, decimals)
    .replace(/0+$/, '')
  const wholeText = whole.toLocaleString('en-US')
  return `${fraction ? `${wholeText}.${fraction}` : wholeText} XLM`
}

export function formatUsd(amount: number): string {
  return amount.toLocaleString('en-US', { style: 'currency', currency: 'USD' })
}

/** Shown before an earnings figure that is a lower bound (#552). */
export const AT_LEAST = 'At least'

/** Shown with the earnings figures while their totals are being rebuilt. */
export const EARNINGS_UPDATING_NOTE =
  'Recounting your earnings. Check again in a few minutes.'

/**
 * The USD note under an earnings figure, for example "≈ $14.87, testnet, no
 * real value". A lower bound reads "at least $14.87" (#552).
 */
export function usdEstimateNote(
  amount: number,
  isTestnet: boolean,
  lowerBound = false
): string {
  const usd = `${lowerBound ? 'at least' : '≈'} ${formatUsd(amount)}`
  return isTestnet ? `${usd}, ${TESTNET_NO_VALUE_NOTE}` : usd
}
