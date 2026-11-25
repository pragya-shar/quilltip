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

export function tipSpeedNote(): string {
  const network = networkLabelLowercase()
  return `Tips typically confirm in a few seconds on Stellar ${network} with near-zero fees.`
}

export function tipDialogFooterNote(): string {
  if (getNetwork() === 'MAINNET') {
    return 'Tips confirm in seconds on Stellar mainnet.'
  }
  return 'Tips confirm in seconds. Practice funds on testnet.'
}

export function tipFlowShortNote(): string {
  const network = networkLabelLowercase()
  if (getNetwork() === 'MAINNET') {
    return `Fast confirmation on Stellar ${network}. You sign in your wallet → the network confirms → your dashboard updates.`
  }
  return `Fast testnet confirmation. You sign in your wallet → the network confirms → your dashboard updates.`
}

// Backwards-compatible exports (existing imports across the app).
export const TESTNET_PRACTICE_NOTE = practiceFundsNote()
export const TESTNET_TIP_SPEED_NOTE = tipSpeedNote()

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

/** Formats stroops as an XLM amount with up to 7 decimals. */
export function formatXlmFromStroops(stroops: string): string {
  const value = /^\d+$/.test(stroops) ? BigInt(stroops) : BigInt(0)
  const whole = value / BigInt(10_000_000)
  const fraction = (value % BigInt(10_000_000))
    .toString()
    .padStart(7, '0')
    .replace(/0+$/, '')
  const wholeText = whole.toLocaleString('en-US')
  return `${fraction ? `${wholeText}.${fraction}` : wholeText} XLM`
}

export function formatUsd(amount: number): string {
  return amount.toLocaleString('en-US', { style: 'currency', currency: 'USD' })
}
