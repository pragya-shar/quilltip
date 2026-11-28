/**
 * How Quilltip starts the WalletConnect sign client (#511): the project ID
 * and metadata it is given, and telemetry to WalletConnect turned off.
 */
import { expect, test, vi } from 'vitest'

const init = vi.hoisted(() => vi.fn(async () => ({})))
vi.mock('@walletconnect/sign-client', () => ({ SignClient: { init } }))

const { loadSignClient, walletConnectMetadata } =
  await import('../../lib/stellar/v2/wallet-kit')
const { SITE_NAME } = await import('../../lib/seo/siteMetadata')

test('starts the sign client with telemetry off', async () => {
  const metadata = walletConnectMetadata('https://www.quilltip.me')
  await loadSignClient({
    projectId: '0123456789abcdef0123456789abcdef',
    metadata,
  })
  expect(init).toHaveBeenCalledTimes(1)
  expect(init).toHaveBeenCalledWith({
    projectId: '0123456789abcdef0123456789abcdef',
    metadata: {
      name: SITE_NAME,
      description: 'Tip writers for their articles on Stellar testnet.',
      url: 'https://www.quilltip.me',
      icons: ['https://www.quilltip.me/favicon.ico'],
    },
    telemetryEnabled: false,
  })
})
