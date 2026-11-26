// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from 'vitest'

/**
 * The WalletConnect module (and with it Reown AppKit and its dependencies) is
 * imported only when NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID is set. Every other
 * kit module loads without it.
 */
const walletConnectImported = vi.hoisted(() => ({ count: 0 }))

vi.mock('@creit.tech/stellar-wallets-kit/modules/wallet-connect', () => {
  walletConnectImported.count += 1
  class WalletConnectModule {
    productId = 'wallet_connect'
    productName = 'WalletConnect'
    constructor(readonly params: { projectId: string }) {}
  }
  return {
    WalletConnectModule,
    WalletConnectTargetChain: {
      PUBLIC: 'stellar:pubnet',
      TESTNET: 'stellar:testnet',
    },
  }
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.resetModules()
  walletConnectImported.count = 0
})

async function loadIds(projectId: string | undefined) {
  vi.stubEnv('NEXT_PUBLIC_STELLAR_NETWORK', 'TESTNET')
  if (projectId !== undefined) {
    vi.stubEnv('NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID', projectId)
  } else {
    vi.stubEnv('NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID', '')
  }
  const { loadWalletKitBundle } =
    await import('../../../lib/stellar/v2/wallet-kit')
  const bundle = await loadWalletKitBundle()
  return bundle.modules.map((m) => m.productId)
}

it('never imports the WalletConnect module without a project ID', async () => {
  for (const value of [undefined, '', '   ']) {
    const ids = await loadIds(value)
    expect(ids).toEqual([
      'varial',
      'xbull',
      'albedo',
      'lobstr',
      'rabet',
      'hana',
    ])
    expect(walletConnectImported.count).toBe(0)
    vi.resetModules()
  }
})

it('adds WalletConnect for testnet when a project ID is set', async () => {
  const ids = await loadIds('qa-project-id')
  expect(ids).toContain('wallet_connect')
  expect(walletConnectImported.count).toBe(1)
})
