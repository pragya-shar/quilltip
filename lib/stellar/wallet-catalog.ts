/**
 * The Stellar wallets Quilltip knows about: the ones it offers, and the ones
 * it does not offer yet with the reason. Plain data with no SDK or Wallets
 * Kit import, so the install guide and error copy can use it on any page
 * without loading wallet code.
 *
 * `docs/wallets.md` has the research behind each entry. The adapter
 * (`lib/stellar/v2/wallet.ts`) reads the capability fields, and the picker
 * and install guide read the presentation fields.
 */

/** Kit module IDs. Varial is the wallet formerly called Freighter. */
export const WALLET_IDS = {
  varial: 'varial',
  xbull: 'xbull',
  albedo: 'albedo',
  lobstr: 'lobstr',
  rabet: 'rabet',
  hana: 'hana',
  scopuly: 'scopuly',
  dcent: 'dcent',
  hot: 'hot-wallet',
  ledger: 'LEDGER',
  trezor: 'TREZOR',
  metamask: 'metamask',
  walletConnect: 'wallet_connect',
} as const

export type WalletId = (typeof WALLET_IDS)[keyof typeof WALLET_IDS]

/**
 * How a reader reaches the wallet from this page:
 * - `extension`: a browser extension injects an API into the page.
 * - `extension-or-web`: the extension when it is installed, otherwise the
 *   wallet's web app in a new window (xBull).
 * - `web`: the wallet's web app in a new window; nothing to install.
 * - `hardware`, `mobile`: listed for completeness; not offered.
 */
export type WalletKind =
  | 'extension'
  | 'extension-or-web'
  | 'web'
  | 'hardware'
  | 'mobile'

export type WalletCapabilities = {
  /** Signs a transaction envelope with the source account. Every offered wallet does. */
  transaction: boolean
  /** Signs envelopes that call a Soroban contract (`invokeHostFunction`). */
  soroban: boolean
  /** Signs a SEP-53 message. Without it the address proof signs a transaction. */
  message: boolean
  /** Signs Soroban authorisation entries. No v2 flow needs it. */
  authEntry: boolean
  /**
   * Tells the page which network it is on. When false, Quilltip checks the
   * returned signature against the testnet passphrase instead.
   */
  reportsNetwork: boolean
}

export type WalletCatalogEntry = {
  id: WalletId
  /** The name readers see. */
  name: string
  /** A previous name readers may know the wallet by. */
  formerly?: string
  kind: WalletKind
  /** Where to install or open the wallet. */
  url: string
  /** The web wallet's own address, when it differs from `url`. */
  webUrl?: string
  /**
   * The wallet's icon on the kit's CDN, which `img-src` allows. Absent when
   * the CDN has none: the picker then uses the kit module's own icon if it
   * is a `data:` URL, and otherwise the wallet's initial.
   */
  icon?: string
  /** The page must be served over HTTPS (WebUSB, WalletConnect). */
  needsHttps: boolean
  /** The wallet opens its own window, which a pop-up blocker can stop. */
  opensWindow: boolean
  capabilities: WalletCapabilities
  /**
   * How long connecting may take before it times out, when longer than the
   * adapter's default (a phone wallet: scan, open, approve).
   */
  connectTimeoutMs?: number
  /** How long a signature may take, when longer than the default. */
  signTimeoutMs?: number
  /** Offered in the picker. When false, `notOfferedReason` says why. */
  offered: boolean
  notOfferedReason?: string
}

const KIT_ICONS = 'https://stellar.creit.tech/wallet-icons'

const FULL: WalletCapabilities = {
  transaction: true,
  soroban: true,
  message: true,
  authEntry: true,
  reportsNetwork: true,
}

/** In picker order: extensions first, then web wallets. */
export const WALLET_CATALOG: readonly WalletCatalogEntry[] = [
  {
    id: WALLET_IDS.varial,
    name: 'Varial',
    formerly: 'Freighter',
    kind: 'extension',
    url: 'https://varialwallet.com',
    icon: `${KIT_ICONS}/varial.png`,
    needsHttps: false,
    opensWindow: false,
    capabilities: FULL,
    offered: true,
  },
  {
    id: WALLET_IDS.xbull,
    name: 'xBull',
    kind: 'extension-or-web',
    url: 'https://xbull.app',
    webUrl: 'https://wallet.xbull.app',
    icon: `${KIT_ICONS}/xbull.png`,
    needsHttps: false,
    opensWindow: true,
    capabilities: { ...FULL, authEntry: false, reportsNetwork: false },
    offered: true,
  },
  {
    id: WALLET_IDS.rabet,
    name: 'Rabet',
    kind: 'extension',
    url: 'https://rabet.io',
    icon: `${KIT_ICONS}/rabet.png`,
    needsHttps: false,
    opensWindow: false,
    capabilities: {
      ...FULL,
      message: false,
      authEntry: false,
      reportsNetwork: false,
    },
    offered: true,
  },
  {
    id: WALLET_IDS.hana,
    name: 'Hana',
    kind: 'extension',
    url: 'https://hanawallet.io',
    icon: `${KIT_ICONS}/hana.png`,
    needsHttps: false,
    opensWindow: false,
    capabilities: { ...FULL, reportsNetwork: false },
    offered: true,
  },
  {
    id: WALLET_IDS.scopuly,
    name: 'Scopuly',
    kind: 'extension',
    url: 'https://extension.scopuly.com',
    needsHttps: false,
    opensWindow: false,
    capabilities: FULL,
    offered: true,
  },
  {
    id: WALLET_IDS.dcent,
    name: "D'CENT",
    kind: 'extension',
    url: 'https://dcentwallet.com',
    needsHttps: false,
    opensWindow: false,
    capabilities: FULL,
    offered: true,
  },
  {
    id: WALLET_IDS.albedo,
    name: 'Albedo',
    kind: 'web',
    url: 'https://albedo.link',
    icon: `${KIT_ICONS}/albedo.png`,
    // Albedo answers http pages too (checked on http://127.0.0.1).
    needsHttps: false,
    opensWindow: true,
    // Albedo has a message intent, but its output is not SEP-53, so the kit
    // reports it as unsupported and the address proof signs a transaction.
    capabilities: {
      ...FULL,
      message: false,
      authEntry: false,
      reportsNetwork: false,
    },
    offered: true,
  },
  {
    id: WALLET_IDS.lobstr,
    name: 'LOBSTR extension',
    kind: 'extension',
    url: 'https://lobstr.co',
    icon: `${KIT_ICONS}/lobstr.png`,
    needsHttps: false,
    opensWindow: false,
    capabilities: { ...FULL, authEntry: false, reportsNetwork: false },
    offered: false,
    notOfferedReason:
      'The LOBSTR signer extension signs for Stellar mainnet only and has no testnet setting.',
  },
  {
    id: WALLET_IDS.hot,
    name: 'HOT Wallet',
    kind: 'extension',
    url: 'https://hot-labs.org/wallet',
    needsHttps: false,
    opensWindow: true,
    capabilities: { ...FULL, reportsNetwork: true },
    offered: false,
    notOfferedReason:
      'The kit module reports Stellar mainnet and sends no network with a signing request, so it cannot sign testnet transactions.',
  },
  {
    id: WALLET_IDS.ledger,
    name: 'Ledger',
    kind: 'hardware',
    url: 'https://www.ledger.com',
    icon: `${KIT_ICONS}/ledger.png`,
    needsHttps: true,
    opensWindow: false,
    capabilities: {
      ...FULL,
      message: false,
      authEntry: false,
      reportsNetwork: false,
    },
    offered: false,
    notOfferedReason:
      'The kit module signs only the transaction hash (blind signing) unless the app passes a flag, and it needs the kit’s own account chooser.',
  },
  {
    id: WALLET_IDS.trezor,
    name: 'Trezor',
    kind: 'hardware',
    url: 'https://trezor.io',
    icon: `${KIT_ICONS}/trezor.png`,
    needsHttps: true,
    opensWindow: true,
    capabilities: {
      transaction: true,
      soroban: false,
      message: false,
      authEntry: false,
      reportsNetwork: false,
    },
    offered: false,
    notOfferedReason:
      'Trezor Connect cannot sign Soroban contract calls, which every Quilltip payment uses.',
  },
  {
    id: WALLET_IDS.metamask,
    name: 'MetaMask',
    kind: 'extension',
    url: 'https://metamask.io',
    needsHttps: false,
    opensWindow: false,
    capabilities: FULL,
    offered: false,
    notOfferedReason:
      'The MetaMask Stellar connector supports Stellar mainnet only.',
  },
  {
    id: WALLET_IDS.walletConnect,
    name: 'Mobile wallet',
    kind: 'mobile',
    url: 'https://walletconnect.network',
    icon: `${KIT_ICONS}/walletconnect.png`,
    needsHttps: false,
    opensWindow: false,
    // The session must include Stellar testnet; the network is checked on the
    // signature, as for other wallets that cannot report it.
    capabilities: { ...FULL, authEntry: false, reportsNetwork: false },
    connectTimeoutMs: 5 * 60_000,
    signTimeoutMs: 5 * 60_000,
    // Shown only when NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID is set.
    offered: true,
  },
]

const BY_ID = new Map<string, WalletCatalogEntry>(
  WALLET_CATALOG.map((entry) => [entry.id, entry])
)

/** The catalog entry for a kit module ID, if Quilltip knows the wallet. */
export function walletEntry(
  id: string | undefined
): WalletCatalogEntry | undefined {
  return id === undefined ? undefined : BY_ID.get(id)
}

/** The wallets Quilltip offers, in picker order. */
export const OFFERED_WALLETS = WALLET_CATALOG.filter((entry) => entry.offered)

/** Offered wallets that work without WalletConnect configured. */
export const BROWSER_WALLETS = OFFERED_WALLETS.filter(
  (entry) => entry.id !== WALLET_IDS.walletConnect
)

/**
 * Phone wallet apps that connect to QuillTip over WalletConnect on Stellar
 * (the kit's featured WalletConnect wallets). Each must be set to testnet.
 */
export const WALLETCONNECT_APPS = [
  {
    name: 'Varial',
    url: 'https://varialwallet.com',
    icon: `${KIT_ICONS}/varial.png`,
  },
  { name: 'LOBSTR', url: 'https://lobstr.co', icon: `${KIT_ICONS}/lobstr.png` },
  { name: 'Scopuly', url: 'https://scopuly.com' },
] as const

/** Their names, for the picker's copy. */
export const WALLETCONNECT_WALLETS = WALLETCONNECT_APPS.map((app) => app.name)

/** The name readers see for a wallet, falling back to the kit's name. */
export function walletDisplayName(
  id: string | undefined,
  fallback = 'your wallet'
) {
  return walletEntry(id)?.name ?? fallback
}
