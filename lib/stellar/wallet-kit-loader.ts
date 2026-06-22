type WalletKitModule = typeof import('@creit.tech/stellar-wallets-kit')

let walletKitModule: WalletKitModule | null = null
let walletKitLoadPromise: Promise<WalletKitModule> | null = null

async function ensureElfProductionMode(): Promise<void> {
  if (process.env.NODE_ENV !== 'production') return
  const { enableElfProdMode } = await import('@ngneat/elf')
  enableElfProdMode()
}

export async function loadWalletKit(): Promise<WalletKitModule> {
  if (walletKitModule) return walletKitModule
  if (!walletKitLoadPromise) {
    walletKitLoadPromise = (async () => {
      await ensureElfProductionMode()
      const mod = await import('@creit.tech/stellar-wallets-kit')
      walletKitModule = mod
      return mod
    })()
  }
  return walletKitLoadPromise
}
