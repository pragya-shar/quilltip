/**
 * Stellar Wallets Kit 2.x adapter (docs/architecture/v2/06-app-integration.md,
 * section 6.6). Every wallet call in the app goes through this module:
 *
 * - `StellarWalletsKit.init` once, with the modules QuillTip supports and the
 *   network from the single network setting (`STELLAR_CONFIG`).
 * - `connect()` opens the kit's `authModal` (or connects one wallet by ID).
 * - `signTransaction()` signs one envelope for the connected address. It
 *   refuses before prompting when the wallet reports another network, and it
 *   checks the signer the wallet returns.
 * - Failures are `WalletError`s with a `kind` the UI turns into copy
 *   (`wallet-errors.ts`).
 *
 * No v2 flow needs `signAuthEntry`: every entry point authorises only the
 * transaction source (section 6.1, step 4), so the adapter does not expose it.
 *
 * WalletConnect (mobile wallets) is not supported yet: see `wallet-kit.ts`.
 * The adapter handles a `wallet_connect` module generically, but the app
 * does not load one.
 *
 * `createWalletAdapter` takes the kit as a dependency so tests can pass a fake.
 */

import type {
  ISupportedWallet,
  ModuleInterface,
  StellarWalletsKitInitParams,
  SwkAppTheme,
} from '@creit.tech/stellar-wallets-kit/types'
import { WalletError, type WalletErrorKind } from './wallet-errors'

export { WalletError, isWalletError } from './wallet-errors'
export type { WalletErrorKind } from './wallet-errors'

/** Kit module IDs QuillTip uses. Varial is the wallet formerly called Freighter. */
export const WALLET_IDS = {
  varial: 'varial',
  xbull: 'xbull',
  albedo: 'albedo',
  lobstr: 'lobstr',
  rabet: 'rabet',
  hana: 'hana',
  walletConnect: 'wallet_connect',
} as const

/** IDs stored by the 1.x adapter that changed in 2.x. */
const LEGACY_WALLET_IDS: Record<string, string> = { freighter: 'varial' }
const LEGACY_STORAGE_KEY = 'selectedWalletId'

/**
 * Wallets that report as available without an extension (web or bridge
 * wallets). They alone do not count as "a wallet is installed".
 */
const WEB_ONLY_WALLETS = new Set<string>([
  WALLET_IDS.albedo,
  WALLET_IDS.xbull,
  WALLET_IDS.walletConnect,
])

export const DEFAULT_SIGN_TIMEOUT_MS = 120_000
export const DEFAULT_NETWORK_TIMEOUT_MS = 10_000
export const DEFAULT_CONNECT_TIMEOUT_MS = 60_000

export type WalletConnection = {
  address: string
  walletId: string
  walletName: string
  /** The wallet's network name, or '' when the wallet does not report one. */
  network: string
  /**
   * The wallet's passphrase when it reports one. Wallets that cannot report a
   * network (xBull, Albedo, Lobstr, Rabet, Hana) sign for the passphrase
   * QuillTip passes, so this is then QuillTip's passphrase and
   * `networkReported` is false.
   */
  networkPassphrase: string
  networkReported: boolean
}

export type WalletSignResult = { signedTxXdr: string; signerAddress: string }

export type WalletEvent =
  | { type: 'connected'; connection: WalletConnection }
  | { type: 'account'; address: string }
  | { type: 'network'; connection: WalletConnection }
  | { type: 'disconnected' }

export type WalletOption = Pick<
  ISupportedWallet,
  'id' | 'name' | 'isAvailable' | 'url'
>

/** The static `StellarWalletsKit` surface the adapter uses. */
export type KitFacade = {
  init(params: StellarWalletsKitInitParams): void
  setWallet(id: string): void
  authModal(params?: { container?: HTMLElement }): Promise<{ address: string }>
  fetchAddress(): Promise<{ address: string }>
  getNetwork(): Promise<{ network: string; networkPassphrase: string }>
  signTransaction(
    xdr: string,
    opts?: { networkPassphrase?: string; address?: string }
  ): Promise<{ signedTxXdr: string; signerAddress?: string }>
  signMessage(
    message: string,
    opts?: { networkPassphrase?: string; address?: string }
  ): Promise<{ signedMessage: string; signerAddress?: string }>
  disconnect(): Promise<void>
  refreshSupportedWallets(): Promise<ISupportedWallet[]>
  on(type: string, callback: (event: unknown) => void): () => void
  readonly selectedModule: Pick<ModuleInterface, 'productId' | 'productName'>
}

export type KitBundle = {
  kit: KitFacade
  modules: ModuleInterface[]
  /** `KitEventType` values from the kit. */
  events: { stateUpdated: string; disconnect: string }
}

export type WalletAdapterOptions = {
  loadKit: () => Promise<KitBundle>
  networkPassphrase: string
  theme?: SwkAppTheme
  storage?: Pick<Storage, 'getItem' | 'removeItem'> | null
  signTimeoutMs?: number
  networkTimeoutMs?: number
  connectTimeoutMs?: number
}

export type WalletAdapter = ReturnType<typeof createWalletAdapter>

type KitErrorShape = {
  code?: number
  message?: string
  error?: { code?: number; message?: string }
}

/** Maps a kit or wallet error (SEP-43 shape, Error or string) to a WalletError. */
export function classifyWalletError(
  error: unknown,
  walletId?: string
): WalletError {
  if (error instanceof WalletError) return error
  const shape = (
    typeof error === 'object' && error !== null ? error : {}
  ) as KitErrorShape
  const code = shape.error?.code ?? shape.code
  const message =
    shape.error?.message ??
    shape.message ??
    (typeof error === 'string' ? error : '') ??
    ''
  const text = message.toLowerCase()
  const fail = (kind: WalletErrorKind, copy = message) =>
    new WalletError(kind, copy || 'Wallet request failed', {
      walletId,
      walletCode: typeof code === 'number' ? code : undefined,
      cause: error,
    })

  if (/closed the modal|modal was closed/.test(text)) {
    return fail('cancelled', 'Wallet selection was closed')
  }
  if (
    code === -4 ||
    /declin|reject|denied|cancel|refused by the user/.test(text)
  ) {
    return fail('rejected')
  }
  if (/timed? ?out/.test(text)) return fail('timeout')
  if (/locked|not allowed|request access|permission/.test(text)) {
    return fail('locked')
  }
  if (/is not (connected|available|installed)|not detected/.test(text)) {
    return fail('no-wallet')
  }
  return fail('failed')
}

function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  walletId: string | undefined
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () =>
        reject(
          new WalletError('timeout', `Wallet did not respond in ${ms} ms`, {
            walletId,
          })
        ),
      ms
    )
  })
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer))
}

function isNotSupported(error: unknown): boolean {
  const message = (error as KitErrorShape)?.message ?? ''
  return /does not support/i.test(message)
}

function isInsecureLocalhost(): boolean {
  if (typeof window === 'undefined') return false
  const { hostname, protocol } = window.location
  return (
    protocol === 'http:' &&
    (hostname === 'localhost' || hostname === '127.0.0.1')
  )
}

/** Stellar mainnet. The adapter never signs for it (section 6.6). */
const MAINNET_PASSPHRASE = 'Public Global Stellar Network ; September 2015'

export function createWalletAdapter(options: WalletAdapterOptions) {
  const expected = options.networkPassphrase
  // The client config already refuses mainnet; the adapter checks again so no
  // signing request can be built for it even if that check is bypassed.
  if (expected.trim() === MAINNET_PASSPHRASE) {
    throw new WalletError(
      'wrong-network',
      'QuillTip does not sign for Stellar mainnet'
    )
  }
  const signTimeoutMs = options.signTimeoutMs ?? DEFAULT_SIGN_TIMEOUT_MS
  const networkTimeoutMs =
    options.networkTimeoutMs ?? DEFAULT_NETWORK_TIMEOUT_MS
  const connectTimeoutMs =
    options.connectTimeoutMs ?? DEFAULT_CONNECT_TIMEOUT_MS
  const listeners = new Set<(event: WalletEvent) => void>()
  let bundle: KitBundle | null = null
  let initPromise: Promise<KitBundle> | null = null
  let connection: WalletConnection | null = null
  let connectPromise: Promise<WalletConnection> | null = null
  let lastAddress: string | null = null

  const emit = (event: WalletEvent) => {
    for (const listener of listeners) listener(event)
  }

  function storedWalletId(): string | undefined {
    const storage = options.storage
    if (!storage) return undefined
    try {
      const legacy = storage.getItem(LEGACY_STORAGE_KEY)
      if (legacy === null) return undefined
      storage.removeItem(LEGACY_STORAGE_KEY)
      return LEGACY_WALLET_IDS[legacy] ?? legacy
    } catch {
      return undefined
    }
  }

  async function init(): Promise<KitBundle> {
    if (bundle) return bundle
    initPromise ??= (async () => {
      const loaded = await options.loadKit()
      const modules = loaded.modules.filter(
        // Albedo refuses plain-http origins; leave it out there.
        (walletModule) =>
          !(
            walletModule.productId === WALLET_IDS.albedo &&
            isInsecureLocalhost()
          )
      )
      const selected = storedWalletId()
      loaded.kit.init({
        modules,
        network: expected as StellarWalletsKitInitParams['network'],
        ...(selected && modules.some((m) => m.productId === selected)
          ? { selectedWalletId: selected }
          : {}),
        ...(options.theme ? { theme: options.theme } : {}),
        authModal: { showInstallLabel: true, hideUnsupportedWallets: false },
      })
      loaded.kit.on(loaded.events.stateUpdated, (event) => {
        const address = (event as { payload?: { address?: string } }).payload
          ?.address
        if (!connection || !address || address === lastAddress) return
        lastAddress = address
        connection = { ...connection, address }
        emit({ type: 'account', address })
      })
      loaded.kit.on(loaded.events.disconnect, () => {
        if (!connection) return
        connection = null
        lastAddress = null
        emit({ type: 'disconnected' })
      })
      bundle = { ...loaded, modules }
      return bundle
    })().catch((error) => {
      initPromise = null
      throw error
    })
    return initPromise
  }

  /** The wallet's network, or null when the wallet cannot report one. */
  async function readNetwork(
    kit: KitFacade,
    walletId: string
  ): Promise<{ network: string; networkPassphrase: string } | null> {
    try {
      const network = await withTimeout(
        kit.getNetwork(),
        networkTimeoutMs,
        walletId
      )
      return network.networkPassphrase ? network : null
    } catch (error) {
      if (isNotSupported(error)) return null
      throw classifyWalletError(error, walletId)
    }
  }

  function assertPassphrase(
    network: { networkPassphrase: string } | null,
    walletId: string
  ) {
    if (network && network.networkPassphrase !== expected) {
      throw new WalletError(
        'wrong-network',
        'The wallet is on a different Stellar network',
        {
          walletId,
          expectedPassphrase: expected,
          walletPassphrase: network.networkPassphrase,
        }
      )
    }
  }

  async function finishConnect(
    kit: KitFacade,
    address: string
  ): Promise<WalletConnection> {
    const walletModule = kit.selectedModule
    const network = await readNetwork(kit, walletModule.productId)
    assertPassphrase(network, walletModule.productId)
    connection = {
      address,
      walletId: walletModule.productId,
      walletName: walletModule.productName,
      network: network?.network ?? '',
      networkPassphrase: network?.networkPassphrase ?? expected,
      networkReported: network !== null,
    }
    lastAddress = address
    emit({ type: 'connected', connection })
    return connection
  }

  async function connectOnce(walletId?: string): Promise<WalletConnection> {
    const { kit } = await init()
    let address: string
    try {
      if (walletId) {
        const id = LEGACY_WALLET_IDS[walletId] ?? walletId
        kit.setWallet(id)
        ;({ address } = await withTimeout(
          kit.fetchAddress(),
          connectTimeoutMs,
          id
        ))
      } else {
        if (!(await hasWallet())) {
          throw new WalletError('no-wallet', 'No Stellar wallet detected')
        }
        ;({ address } = await kit.authModal())
      }
    } catch (error) {
      throw classifyWalletError(error, walletId)
    }
    if (!address) {
      throw new WalletError('locked', 'The wallet did not share an address', {
        walletId,
      })
    }
    return finishConnect(kit, address)
  }

  /** Supported wallets and whether each is available in this browser. */
  async function listWallets(): Promise<WalletOption[]> {
    const { kit } = await init()
    const wallets = await kit.refreshSupportedWallets()
    return wallets.map(({ id, name, isAvailable, url }) => ({
      id,
      name,
      isAvailable,
      url,
    }))
  }

  /**
   * True when an installed wallet is available, or WalletConnect is
   * configured (mobile wallets connect through it without an extension).
   */
  async function hasWallet(): Promise<boolean> {
    const { modules } = await init()
    if (modules.some((m) => m.productId === WALLET_IDS.walletConnect)) {
      return true
    }
    const wallets = await listWallets()
    return wallets.some((w) => w.isAvailable && !WEB_ONLY_WALLETS.has(w.id))
  }

  return {
    init: async () => {
      await init()
    },
    hasWallet,
    listWallets,
    /**
     * Opens the wallet picker, or connects `walletId` directly. Resolves once
     * the address is known and the network checked. Concurrent calls share
     * one picker.
     */
    connect(opts: { walletId?: string } = {}): Promise<WalletConnection> {
      connectPromise ??= connectOnce(opts.walletId).finally(() => {
        connectPromise = null
      })
      return connectPromise
    },
    /** The current connection, without prompting the wallet. */
    getConnection: (): WalletConnection | null => connection,
    /**
     * Asks the wallet for its network again (no prompt) and updates the
     * connection. Throws `wrong-network` when it moved to another network.
     */
    async refreshNetwork(): Promise<WalletConnection | null> {
      if (!connection) return null
      const { kit } = await init()
      const network = await readNetwork(kit, connection.walletId)
      if (network) {
        const changed =
          network.networkPassphrase !== connection.networkPassphrase
        connection = {
          ...connection,
          network: network.network,
          networkPassphrase: network.networkPassphrase,
          networkReported: true,
        }
        if (changed) emit({ type: 'network', connection })
      }
      assertPassphrase(network, connection.walletId)
      return connection
    },
    /**
     * Signs one transaction envelope (classic or Soroban) with the connected
     * address, for QuillTip's network. Checks the wallet's network first and
     * the returned signer after.
     */
    async signTransaction(
      xdr: string,
      opts: { address?: string; timeoutMs?: number } = {}
    ): Promise<WalletSignResult> {
      const current = connection
      if (!current) {
        throw new WalletError('locked', 'Connect a wallet first')
      }
      const address = opts.address ?? current.address
      const { kit } = await init()
      const network = await readNetwork(kit, current.walletId)
      assertPassphrase(network, current.walletId)
      let result: { signedTxXdr: string; signerAddress?: string }
      try {
        result = await withTimeout(
          kit.signTransaction(xdr, { address, networkPassphrase: expected }),
          opts.timeoutMs ?? signTimeoutMs,
          current.walletId
        )
      } catch (error) {
        throw classifyWalletError(error, current.walletId)
      }
      if (!result.signedTxXdr) {
        throw new WalletError('failed', 'The wallet returned no signature', {
          walletId: current.walletId,
        })
      }
      if (result.signerAddress && result.signerAddress !== address) {
        throw new WalletError(
          'wrong-account',
          'The wallet signed with a different account',
          { walletId: current.walletId }
        )
      }
      return {
        signedTxXdr: result.signedTxXdr,
        signerAddress: result.signerAddress ?? address,
      }
    },
    /**
     * Signs `message` with the connected address (SEP-53, for proving control
     * of the address). Throws `unsupported` for wallets that cannot sign
     * messages (Albedo, Rabet); callers then use a signed transaction instead.
     */
    async signMessage(
      message: string,
      opts: { timeoutMs?: number } = {}
    ): Promise<{ signedMessage: string; signerAddress: string }> {
      const current = connection
      if (!current) {
        throw new WalletError('locked', 'Connect a wallet first')
      }
      const { kit } = await init()
      const network = await readNetwork(kit, current.walletId)
      assertPassphrase(network, current.walletId)
      let result: { signedMessage: string; signerAddress?: string }
      try {
        result = await withTimeout(
          kit.signMessage(message, {
            address: current.address,
            networkPassphrase: expected,
          }),
          opts.timeoutMs ?? signTimeoutMs,
          current.walletId
        )
      } catch (error) {
        if (isNotSupported(error)) {
          throw new WalletError(
            'unsupported',
            'This wallet cannot sign messages',
            { walletId: current.walletId, cause: error }
          )
        }
        throw classifyWalletError(error, current.walletId)
      }
      if (!result.signedMessage) {
        throw new WalletError('failed', 'The wallet returned no signature', {
          walletId: current.walletId,
        })
      }
      if (result.signerAddress && result.signerAddress !== current.address) {
        throw new WalletError(
          'wrong-account',
          'The wallet signed with a different account',
          { walletId: current.walletId }
        )
      }
      return {
        signedMessage: result.signedMessage,
        signerAddress: result.signerAddress ?? current.address,
      }
    },
    /** Forgets the connection and closes any WalletConnect session. */
    async disconnect(): Promise<void> {
      const wasConnected = connection !== null
      connection = null
      lastAddress = null
      if (bundle) {
        try {
          await bundle.kit.disconnect()
        } catch {
          // The kit clears its own state even when a module fails to close.
        }
      }
      if (wasConnected) emit({ type: 'disconnected' })
    },
    /** Subscribes to connection, account, network and disconnect events. */
    subscribe(listener: (event: WalletEvent) => void): () => void {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  }
}
