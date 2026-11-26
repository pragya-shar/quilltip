// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from 'vitest'

/**
 * WalletConnect is on with a Reown project ID, off without one, and a
 * malformed ID stops the app. Neither the kit's WalletConnect module nor
 * Reown AppKit is ever imported, and the sign client loads only when a
 * reader pairs a phone, never while the kit loads.
 */
const imported = vi.hoisted(() => ({ kitModule: 0, appKit: 0, signClient: 0 }))

vi.mock('@creit.tech/stellar-wallets-kit/modules/wallet-connect', () => {
  imported.kitModule += 1
  return {}
})
vi.mock('@reown/appkit/core', () => {
  imported.appKit += 1
  return {}
})
vi.mock('@walletconnect/sign-client', () => {
  imported.signClient += 1
  return { SignClient: { init: vi.fn() } }
})

// Format only; not a Reown project.
const FORMAT_ONLY_ID = '0123456789abcdef0123456789abcdef'
const BROWSER_WALLETS = [
  'varial',
  'xbull',
  'rabet',
  'hana',
  'scopuly',
  'dcent',
  'albedo',
]

afterEach(() => {
  vi.unstubAllEnvs()
  vi.resetModules()
  imported.kitModule = 0
  imported.appKit = 0
  imported.signClient = 0
})

async function loadIds(projectId: string | undefined) {
  vi.stubEnv('NEXT_PUBLIC_STELLAR_NETWORK', 'TESTNET')
  vi.stubEnv('NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID', projectId ?? '')
  const { loadWalletKitBundle } =
    await import('../../../lib/stellar/v2/wallet-kit')
  const bundle = await loadWalletKitBundle()
  return bundle.modules.map((m) => m.productId)
}

it('leaves WalletConnect out without a project ID', async () => {
  for (const value of [undefined, '', '   ']) {
    expect(await loadIds(value)).toEqual(BROWSER_WALLETS)
    vi.resetModules()
  }
  expect(imported).toEqual({ kitModule: 0, appKit: 0, signClient: 0 })
})

it('adds QuillTip’s WalletConnect module with a project ID, without loading the sign client yet', async () => {
  expect(await loadIds(FORMAT_ONLY_ID)).toEqual([
    ...BROWSER_WALLETS,
    'wallet_connect',
  ])
  expect(imported).toEqual({ kitModule: 0, appKit: 0, signClient: 0 })
})

it('refuses a malformed project ID in the browser', async () => {
  const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
  for (const value of [
    'qa-project-id',
    FORMAT_ONLY_ID.toUpperCase(),
    `${FORMAT_ONLY_ID}0`,
  ]) {
    await expect(loadIds(value)).rejects.toThrow(
      'NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID is not a Reown project ID'
    )
    vi.resetModules()
  }
  errors.mockRestore()
})

it('stops the build, dev server and production start for a malformed project ID', async () => {
  const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
  vi.stubEnv('NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID', 'qa-project-id')
  await expect(import('../../../next.config')).rejects.toThrow(
    'is not a Reown project ID'
  )
  expect(errors).toHaveBeenCalledWith(
    expect.stringContaining('is not a Reown project ID')
  )
  errors.mockRestore()
})

it('loads the Next.js config with no project ID and with a well-formed one', async () => {
  for (const value of ['', FORMAT_ONLY_ID]) {
    vi.stubEnv('NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID', value)
    const config = await import('../../../next.config')
    expect(config.default).toBeTruthy()
    vi.resetModules()
  }
})
