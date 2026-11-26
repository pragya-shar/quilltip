/**
 * Loads Stellar Wallets Kit 2.x and the modules QuillTip offers, on demand in
 * the browser. Only this file imports the kit at runtime.
 *
 * Modules: Varial (formerly Freighter), xBull, Albedo, LOBSTR, Rabet and
 * Hana. HOT Wallet is not offered: its module needs global and Buffer
 * polyfills.
 *
 * WalletConnect (mobile wallets) is not supported yet. The kit's WalletConnect
 * module depends on Reown AppKit, which this app runs on zod 4 through a
 * package override (zod 3 has an unpatched advisory). That combination has
 * not been tested, so setting NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID makes the
 * wallet fail to start with a clear error instead of loading it silently.
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

export const WALLETCONNECT_UNSUPPORTED_MESSAGE =
  'WalletConnect is not supported yet: its Reown AppKit dependency has not been tested with the zod 4 override. Unset NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID.'

/** Refuses to start when WalletConnect is configured (see the file comment). */
function assertWalletConnectDisabled() {
  if (!WALLETCONNECT_PROJECT_ID) return
  console.error(`[wallet] ${WALLETCONNECT_UNSUPPORTED_MESSAGE}`)
  throw new Error(WALLETCONNECT_UNSUPPORTED_MESSAGE)
}

export async function loadWalletKitBundle(): Promise<KitBundle> {
  assertWalletConnectDisabled()
  const [
    { StellarWalletsKit },
    { KitEventType },
    { VarialModule },
    { xBullModule },
    { AlbedoModule },
    { LobstrModule },
    { RabetModule },
    { HanaModule },
  ] = await Promise.all([
    import('@creit.tech/stellar-wallets-kit/sdk'),
    import('@creit.tech/stellar-wallets-kit/types'),
    import('@creit.tech/stellar-wallets-kit/modules/varial'),
    import('@creit.tech/stellar-wallets-kit/modules/xbull'),
    import('@creit.tech/stellar-wallets-kit/modules/albedo'),
    import('@creit.tech/stellar-wallets-kit/modules/lobstr'),
    import('@creit.tech/stellar-wallets-kit/modules/rabet'),
    import('@creit.tech/stellar-wallets-kit/modules/hana'),
  ])
  const modules: ModuleInterface[] = [
    new VarialModule(),
    new xBullModule(),
    new AlbedoModule(),
    new LobstrModule(),
    new RabetModule(),
    new HanaModule(),
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
