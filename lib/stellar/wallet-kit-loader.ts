type WalletKitModule = typeof import('@creit.tech/stellar-wallets-kit')

let walletKitModule: WalletKitModule | null = null
let walletKitLoadPromise: Promise<WalletKitModule> | null = null

export async function loadWalletKit(): Promise<WalletKitModule> {
  if (walletKitModule) return walletKitModule
  if (!walletKitLoadPromise) {
    walletKitLoadPromise = import('@creit.tech/stellar-wallets-kit').then(
      (mod) => {
        walletKitModule = mod
        return mod
      }
    )
  }
  return walletKitLoadPromise
}
