/**
 * Kit modules that return `isAvailable: true` without a browser extension (web / bridge).
 * IDs must match `productId` on @creit.tech/stellar-wallets-kit modules (albedo, xbull, hot-wallet).
 */
const WALLETS_ALWAYS_AVAILABLE_WITHOUT_EXTENSION = new Set<string>([
  'albedo',
  'xbull',
  'hot-wallet',
])

export function hasInstalledWalletForKitModal(
  supported: Array<{ id: string; isAvailable: boolean }>
): boolean {
  return supported.some(
    (w) =>
      w.isAvailable &&
      !WALLETS_ALWAYS_AVAILABLE_WITHOUT_EXTENSION.has(w.id)
  )
}
