/**
 * Loads Stellar Wallets Kit 2.x and the modules Quilltip offers, on demand in
 * the browser. Only this file imports the kit at runtime.
 *
 * Modules: Varial (formerly Freighter), xBull (extension, or its web wallet
 * in a new window), Rabet, Hana, Scopuly, D'CENT and Albedo, the order of
 * `OFFERED_WALLETS` in `../wallet-catalog.ts`. `docs/wallets.md` lists the
 * wallets that are not offered and why: LOBSTR's extension, HOT Wallet and
 * MetaMask sign for Stellar mainnet only, Trezor cannot sign Soroban calls
 * through the kit, and Ledger would sign a bare transaction hash.
 *
 * WalletConnect (mobile wallets) is added when
 * NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID is set (`walletconnect-gate.ts`). It
 * is Quilltip's own module on `@walletconnect/sign-client`
 * (`walletconnect-module.ts`), not the kit's, so Reown AppKit is never
 * loaded; the sign client loads only when a reader chooses a mobile wallet.
 */

import type {
  ModuleInterface,
  SwkAppTheme,
} from '@creit.tech/stellar-wallets-kit/types'
import { STELLAR_CONFIG } from '@/lib/stellar/config'
import { SITE_NAME } from '@/lib/seo/siteMetadata'
import { createWalletAdapter, type KitBundle } from './wallet'
import { configuredWalletConnectProjectId } from './walletconnect-gate'
import { walletConnectPairing } from './walletconnect-pairing'
import {
  WALLETCONNECT_ID,
  WalletConnectModule,
  type WcMetadata,
  type WcSignClient,
} from './walletconnect-module'
import { browserStorage } from '../../wallet/remembered-wallet'

export type { WalletConnection, WalletEvent, WalletSignResult } from './wallet'

/** The kit modal in the Quilltip account palette (cream, ink, wine). */
export const QUILLTIP_WALLET_THEME: SwkAppTheme = {
  background: '#faf5ec',
  'background-secondary': '#f3e9db',
  'foreground-strong': '#390c18',
  foreground: '#390c18',
  'foreground-secondary': '#5e535a',
  primary: '#790333',
  'primary-foreground': '#fff3e2',
  transparent: 'rgba(0, 0, 0, 0)',
  lighter: '#fffaf2',
  light: '#f6eddf',
  'light-gray': '#cdb9b4',
  gray: '#98747b',
  danger: '#942339',
  border: 'rgba(57, 12, 24, 0.18)',
  shadow: '0 18px 40px -24px rgba(57, 12, 24, 0.45)',
  'border-radius': '6px',
  'font-family': "'Landing Syne', 'Account Syne', system-ui, sans-serif",
}

export { WALLETCONNECT_INVALID_MESSAGE } from './walletconnect-gate'

/**
 * What wallets show about Quilltip when pairing. The URL is the page's own
 * origin: WalletConnect's Verify API compares it with the origin the request
 * came from, and the Reown project allows production, previews and local
 * development.
 */
export function walletConnectMetadata(origin: string): WcMetadata {
  return {
    name: SITE_NAME,
    description: 'Tip writers for their articles on Stellar testnet.',
    url: origin,
    icons: [`${origin}/favicon.ico`],
  }
}

/** The sign client, loaded on first use; telemetry to WalletConnect is off. */
export async function loadSignClient(options: {
  projectId: string
  metadata: WcMetadata
}): Promise<WcSignClient> {
  const { SignClient } = await import('@walletconnect/sign-client')
  const client = await SignClient.init({
    projectId: options.projectId,
    metadata: options.metadata,
    telemetryEnabled: false,
  })
  return client as unknown as WcSignClient
}

export async function loadWalletKitBundle(): Promise<KitBundle> {
  // The build refuses a malformed project ID too (next.config.ts).
  const walletConnectProjectId = configuredWalletConnectProjectId()
  const [
    { StellarWalletsKit },
    { KitEventType },
    { VarialModule },
    { xBullModule },
    { RabetModule },
    { HanaModule },
    { ScopulyModule },
    { DcentModule },
    { AlbedoModule },
  ] = await Promise.all([
    import('@creit.tech/stellar-wallets-kit/sdk'),
    import('@creit.tech/stellar-wallets-kit/types'),
    import('@creit.tech/stellar-wallets-kit/modules/varial'),
    import('@creit.tech/stellar-wallets-kit/modules/xbull'),
    import('@creit.tech/stellar-wallets-kit/modules/rabet'),
    import('@creit.tech/stellar-wallets-kit/modules/hana'),
    import('@creit.tech/stellar-wallets-kit/modules/scopuly'),
    import('@creit.tech/stellar-wallets-kit/modules/dcent'),
    import('@creit.tech/stellar-wallets-kit/modules/albedo'),
  ])
  // In the order of OFFERED_WALLETS; the picker keeps the kit's order.
  const modules: ModuleInterface[] = [
    new VarialModule(),
    new xBullModule(),
    new RabetModule(),
    new HanaModule(),
    new ScopulyModule(),
    new DcentModule(),
    new AlbedoModule(),
  ]
  if (walletConnectProjectId) {
    modules.push(
      new WalletConnectModule({
        projectId: walletConnectProjectId,
        metadata: walletConnectMetadata(window.location.origin),
        loadSignClient,
        pairing: walletConnectPairing,
        // The phone ended the session: forget the connection here too.
        onSessionEnded: () => void wallet.disconnect(),
        rememberedAccount: () => {
          const remembered = wallet.rememberedWallet()
          return remembered?.walletId === WALLETCONNECT_ID
            ? remembered.address
            : null
        },
      })
    )
  }
  return {
    kit: StellarWalletsKit as unknown as KitBundle['kit'],
    modules,
    events: {
      stateUpdated: KitEventType.STATE_UPDATED,
      disconnect: KitEventType.DISCONNECT,
    },
  }
}

const loadSignatureChecks = () => import('./wallet-signature')

/** The app's wallet adapter. Loads the kit on first use. */
export const wallet = createWalletAdapter({
  loadKit: loadWalletKitBundle,
  networkPassphrase: STELLAR_CONFIG.NETWORK_PASSPHRASE,
  theme: QUILLTIP_WALLET_THEME,
  storage: browserStorage(),
  verifySignature: async (signedTxXdr, address, passphrase) =>
    (await loadSignatureChecks()).checkSourceSignature(
      signedTxXdr,
      address,
      passphrase
    ),
  describeEnvelope: async (xdr) =>
    (await loadSignatureChecks()).describeEnvelope(
      xdr,
      STELLAR_CONFIG.NETWORK_PASSPHRASE
    ),
})
