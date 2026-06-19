import { MIN_WITHDRAWAL_USD } from '@/lib/constants'
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

/**
 * Explains what "withdraw" actually does today vs future mainnet behavior.
 * Keep this aligned with `convex/tips.ts` withdrawEarnings.
 */
export function withdrawalFlowNote(): string {
  if (getNetwork() === 'MAINNET') {
    return 'Withdrawals submit an on-chain transfer to your Stellar wallet. Confirmation time depends on the network.'
  }
  return 'Withdrawals are testnet-only today and are simulated off-chain. Your dashboard marks them complete after a short delay.'
}

export function withdrawalNote(): string {
  if (getNetwork() === 'MAINNET') {
    return `Move earnings to your Stellar wallet once your available balance reaches $${MIN_WITHDRAWAL_USD.toFixed(0)}.`
  }
  return `Move testnet earnings to your Stellar wallet once your available balance reaches $${MIN_WITHDRAWAL_USD.toFixed(0)}. Test funds only—not withdrawable as real money.`
}

export function withdrawalDialogTitle(): string {
  return getNetwork() === 'MAINNET'
    ? 'Withdraw Earnings'
    : 'Withdraw Testnet Earnings'
}

export function withdrawalDialogDescription(): string {
  return getNetwork() === 'MAINNET'
    ? 'Send earnings to your Stellar wallet'
    : 'Send testnet XLM to your Stellar wallet'
}

export function tipFlowShortNote(): string {
  const network = networkLabelLowercase()
  if (getNetwork() === 'MAINNET') {
    return `Fast confirmation on Stellar ${network}. You sign in your wallet → the network confirms → your dashboard updates.`
  }
  return `Fast testnet confirmation. You sign in your wallet → the network confirms → your dashboard updates.`
}

export function withdrawalAcknowledgementLabel(): string {
  if (getNetwork() === 'MAINNET') {
    return 'I understand this will submit an on-chain transfer and may take time to confirm.'
  }
  return 'I understand these are testnet practice funds and withdrawals are simulated off-chain.'
}

// Backwards-compatible exports (existing imports across the app).
export const TESTNET_PRACTICE_NOTE = practiceFundsNote()
export const TESTNET_TIP_SPEED_NOTE = tipSpeedNote()
export const TESTNET_WITHDRAWAL_NOTE = withdrawalNote()

export const MAINNET_COMING_NOTE =
  'We are working toward a mainnet launch where tips will use real funds. Until then, everything on Quilltip is testnet practice.'
