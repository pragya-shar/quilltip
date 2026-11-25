import type { StellarNetwork } from './network'

/** Fixed practice rate (USD per XLM), used only on TESTNET. */
export const TESTNET_FALLBACK_XLM_TO_USD_RATE = 0.22

export class XlmPriceUnavailableError extends Error {
  constructor(network: string) {
    super(
      `XLM price is unavailable and no fallback rate is allowed on ${network}. No tip was quoted. Try again shortly.`
    )
    this.name = 'XlmPriceUnavailableError'
  }
}

/**
 * Price to use when the server price cache is empty, stale, or unreachable.
 * Only TESTNET may use the fixed practice rate; other networks fail closed.
 */
export function fallbackXlmPrice(
  network: StellarNetwork | string,
  rate: number = TESTNET_FALLBACK_XLM_TO_USD_RATE
): number {
  if (network !== 'TESTNET') {
    throw new XlmPriceUnavailableError(network)
  }
  return rate
}
