import { MIN_WITHDRAWAL_USD } from '@/lib/constants'

export const TESTNET_PRACTICE_NOTE =
  'Quilltip runs on Stellar testnet. Tips use free test XLM for practice—not real money.'

export const TESTNET_TIP_SPEED_NOTE =
  'Tips settle in about 3 seconds on Stellar testnet with near-zero fees.'

export const TESTNET_WITHDRAWAL_NOTE = `Move testnet earnings to your Stellar wallet once your available balance reaches $${MIN_WITHDRAWAL_USD.toFixed(0)}. Test funds only—not withdrawable as real money.`

export const MAINNET_COMING_NOTE =
  'We are working toward a mainnet launch where tips will use real funds. Until then, everything on Quilltip is testnet practice.'
