/**
 * Loads Stellar Wallets Kit 2.x and the modules QuillTip offers, on demand in
 * the browser. Only this file imports the kit at runtime.
 *
 * Modules: Varial (formerly Freighter), xBull, Albedo, LOBSTR, Rabet and
 * Hana. WalletConnect (mobile wallets) is added only when
 * NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID is set; it pulls in Reown AppKit, so it
 * loads in its own chunk. HOT Wallet is not offered: its module needs global
 * and Buffer polyfills.
 */

import type {
  ModuleInterface,
  SwkAppTheme,
} from '@creit.tech/stellar-wallets-kit/types'
import { STELLAR_CONFIG } from '@/lib/stellar/config'
import { createWalletAdapter, type KitBundle } from './wallet'

export type { WalletConnection, WalletEvent, WalletSignResult } from './wallet'

/** The kit modal in the QuillTip account palette (cream, ink, wine). */
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

const WALLETCONNECT_PROJECT_ID =
  process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID?.trim() || ''

async function walletConnectModule(): Promise<ModuleInterface | null> {
  if (!WALLETCONNECT_PROJECT_ID || typeof window === 'undefined') return null
  const { WalletConnectModule, WalletConnectTargetChain } =
    await import('@creit.tech/stellar-wallets-kit/modules/wallet-connect')
  return new WalletConnectModule({
    projectId: WALLETCONNECT_PROJECT_ID,
    metadata: {
      name: 'QuillTip',
      description: 'Tip writers on Stellar',
      url: window.location.origin,
      icons: [`${window.location.origin}/favicon.ico`],
    },
    allowedChains: [
      STELLAR_CONFIG.WALLET_NETWORK === 'PUBLIC'
        ? WalletConnectTargetChain.PUBLIC
        : WalletConnectTargetChain.TESTNET,
    ],
  })
}

export async function loadWalletKitBundle(): Promise<KitBundle> {
  const [
    { StellarWalletsKit },
    { KitEventType },
    { VarialModule },
    { xBullModule },
    { AlbedoModule },
    { LobstrModule },
    { RabetModule },
    { HanaModule },
    walletConnect,
  ] = await Promise.all([
    import('@creit.tech/stellar-wallets-kit/sdk'),
    import('@creit.tech/stellar-wallets-kit/types'),
    import('@creit.tech/stellar-wallets-kit/modules/varial'),
    import('@creit.tech/stellar-wallets-kit/modules/xbull'),
    import('@creit.tech/stellar-wallets-kit/modules/albedo'),
    import('@creit.tech/stellar-wallets-kit/modules/lobstr'),
    import('@creit.tech/stellar-wallets-kit/modules/rabet'),
    import('@creit.tech/stellar-wallets-kit/modules/hana'),
    walletConnectModule(),
  ])
  const modules: ModuleInterface[] = [
    new VarialModule(),
    new xBullModule(),
    new AlbedoModule(),
    new LobstrModule(),
    new RabetModule(),
    new HanaModule(),
    ...(walletConnect ? [walletConnect] : []),
  ]
  return {
    kit: StellarWalletsKit as unknown as KitBundle['kit'],
    modules,
    events: {
      stateUpdated: KitEventType.STATE_UPDATED,
      disconnect: KitEventType.DISCONNECT,
    },
  }
}

/** The app's wallet adapter. Loads the kit on first use. */
export const wallet = createWalletAdapter({
  loadKit: loadWalletKitBundle,
  networkPassphrase: STELLAR_CONFIG.NETWORK_PASSPHRASE,
  theme: QUILLTIP_WALLET_THEME,
  storage: typeof window === 'undefined' ? null : window.localStorage,
})
