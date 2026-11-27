// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from 'vitest'

/**
 * The WalletConnect module (and with it Reown AppKit and its zod-dependent
 * code) is never imported. With NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID unset the
 * other modules load; with it set the wallet refuses to start.
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
      'rabet',
      'hana',
      'scopuly',
      'dcent',
      'albedo',
    ])
    expect(walletConnectImported.count).toBe(0)
    vi.resetModules()
  }
})

it('refuses to start, without importing the module, when a project ID is set', async () => {
  await expect(loadIds('qa-project-id')).rejects.toThrow(
    'WalletConnect is not supported yet'
  )
  expect(walletConnectImported.count).toBe(0)
})

it('stops the build, dev server and production start when a project ID is set', async () => {
  const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
  vi.stubEnv('NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID', 'qa-project-id')
  await expect(import('../../../next.config')).rejects.toThrow(
    'WalletConnect is not supported yet'
  )
  expect(errors).toHaveBeenCalledWith(
    expect.stringContaining('WalletConnect is not supported yet')
  )
  errors.mockRestore()
})

it('loads the Next.js config when no project ID is set', async () => {
  vi.stubEnv('NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID', '')
  const config = await import('../../../next.config')
  expect(config.default).toBeTruthy()
})
