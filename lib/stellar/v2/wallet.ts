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
 * A wallet that cannot sign what a request needs (a Soroban envelope, a
 * message) fails with `unsupported` before it is prompted.
 *
 * Per-wallet behaviour comes from the wallet catalog (`../wallet-catalog.ts`)
 * and the error rules in `wallet-errors.ts`. Web wallets (xBull without its
 * extension, Albedo) open their own window: a blocked window fails with
 * `popup-blocked` at once instead of waiting for the timeout. Wallets that
 * cannot report their network get their signature checked against
 * QuillTip's passphrase instead (`verifySignature`).
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
import {
  WALLET_IDS,
  walletEntry,
  type WalletCatalogEntry,
  type WalletKind,
} from '../wallet-catalog'
import {
  SIGNED_FOR_ANOTHER_NETWORK,
  WalletError,
  classifyWalletError,
} from './wallet-errors'

export { WALLET_IDS } from '../wallet-catalog'
export {
  WalletError,
  classifyWalletError,
  isWalletError,
} from './wallet-errors'
export type { WalletErrorKind } from './wallet-errors'

/** IDs stored by the 1.x adapter that changed in 2.x. */
const LEGACY_WALLET_IDS: Record<string, string> = { freighter: 'varial' }
const LEGACY_STORAGE_KEY = 'selectedWalletId'

/** Wallet kinds whose kit module reports available without an extension. */
const WINDOW_KINDS = new Set<WalletKind>(['web', 'extension-or-web', 'mobile'])

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

/**
 * How the reader can use a wallet in this browser:
 * - `installed`: its extension answered.
 * - `web`: it opens its own window; nothing to install.
 * - `not-installed`: an extension that did not answer.
 * - `unavailable`: it cannot work on this page (`unavailableReason` says why).
 */
export type WalletAccess = 'installed' | 'web' | 'not-installed' | 'unavailable'

export type WalletOption = Pick<
  ISupportedWallet,
  'id' | 'name' | 'isAvailable' | 'url'
> & {
  /** An icon `img-src` allows, or none (the picker shows the initial). */
  icon?: string
  access: WalletAccess
  kind: WalletKind
  formerly?: string
  unavailableReason?: string
}

/** What the adapter reads from the page. Tests pass their own. */
export type WalletPage = {
  /** The page is served over HTTPS. */
  isHttps(): boolean
  /** xBull's extension is installed (it injects `window.xBullSDK`). */
  hasXbullExtension(): boolean
  /** The window whose `open` web wallets call, to notice a blocked pop-up. */
  popupHost?: { open: (...args: never[]) => unknown } | null
}

/** Result of checking a signed envelope against QuillTip's network. */
export type SignatureCheck = 'ok' | 'wrong-network' | 'wrong-account'

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
  page?: WalletPage
  /**
   * Checks the source signature in a signed envelope for `passphrase`. Used
   * for wallets that cannot report their network.
   */
  verifySignature?: (
    signedTxXdr: string,
    address: string,
    passphrase: string
  ) => Promise<SignatureCheck>
  /** Whether an envelope calls a Soroban contract. */
  describeEnvelope?: (xdr: string) => Promise<{ soroban: boolean }>
}

export type WalletAdapter = ReturnType<typeof createWalletAdapter>

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
  const message = (error as { message?: unknown })?.message
  return typeof message === 'string' && /does not support/i.test(message)
}

/** The page the adapter runs in, read from `window`. */
export function browserPage(): WalletPage {
  const win =
    typeof window === 'undefined'
      ? undefined
      : (window as Window & { xBullSDK?: unknown })
  return {
    isHttps: () => win?.location.protocol === 'https:',
    hasXbullExtension: () => Boolean(win?.xBullSDK),
    popupHost: win ?? null,
  }
}

/** Why a wallet cannot work on this page, or undefined when it can. */
export function unavailableReason(
  entry: WalletCatalogEntry | undefined,
  page: WalletPage
): string | undefined {
  if (entry?.needsHttps && !page.isHttps()) {
    return `${entry.name} works only on a secure (https) page, and this page uses http.`
  }
  return undefined
}

/** How often a watched wallet window is checked, and the wait after it closes. */
export const POPUP_POLL_MS = 250
export const POPUP_CLOSED_GRACE_MS = 1_000

type PopupObserver = (opened: { closed?: boolean } | null) => void
let watchers = 0
let restoreOpen: (() => void) | null = null
const observers = new Set<PopupObserver>()

/**
 * Runs a request to a wallet that opens its own window (xBull's web wallet,
 * Albedo) and ends it early when the window shows the outcome:
 * - `popup-blocked` at once when the browser returns no window;
 * - `rejected` when the reader closes the window and the wallet has not
 *   answered a second later (Albedo never answers a closed window).
 * The page's `open` is wrapped only while a request is watched.
 */
export function watchPopups<T>(
  host: WalletPage['popupHost'],
  walletId: string,
  request: () => Promise<T>
): Promise<T> {
  if (!host) return request()
  const timers: ReturnType<typeof setTimeout>[] = []
  let fail: (error: WalletError) => void = () => {}
  const failed = new Promise<never>((_, reject) => {
    fail = reject
  })
  const observer: PopupObserver = (opened) => {
    if (!opened) {
      fail(
        new WalletError(
          'popup-blocked',
          'The browser blocked the wallet window',
          { walletId }
        )
      )
      return
    }
    const poll = setInterval(() => {
      if (!opened.closed) return
      clearInterval(poll)
      timers.push(
        setTimeout(
          () =>
            fail(
              new WalletError(
                'rejected',
                'The wallet window was closed before the request was approved',
                { walletId }
              )
            ),
          POPUP_CLOSED_GRACE_MS
        )
      )
    }, POPUP_POLL_MS)
    timers.push(poll)
  }
  observers.add(observer)
  if (watchers++ === 0) {
    const original = host.open
    const wrapped = (...args: never[]) => {
      const opened = original.apply(host, args) as { closed?: boolean } | null
      observers.forEach((notify) => notify(opened ?? null))
      return opened
    }
    host.open = wrapped
    restoreOpen = () => {
      if (host.open === wrapped) host.open = original
    }
  }
  return Promise.race([request(), failed]).finally(() => {
    timers.forEach((timer) => clearTimeout(timer))
    observers.delete(observer)
    if (--watchers === 0) {
      restoreOpen?.()
      restoreOpen = null
    }
  })
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
  const page = options.page ?? browserPage()
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
      // Every module stays loaded, so the picker can list a wallet that
      // cannot work on this page (Albedo over http) and say why.
      const modules = loaded.modules
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

  /** Runs a wallet request, failing at once when its window is blocked. */
  function guarded<T>(walletId: string, request: () => Promise<T>) {
    return walletEntry(walletId)?.opensWindow
      ? watchPopups(page.popupHost, walletId, request)
      : request()
  }

  async function connectOnce(walletId?: string): Promise<WalletConnection> {
    const { kit } = await init()
    let address: string
    const id = walletId ? (LEGACY_WALLET_IDS[walletId] ?? walletId) : undefined
    const reason = unavailableReason(walletEntry(id), page)
    if (reason) throw new WalletError('unsupported', reason, { walletId: id })
    try {
      if (id) {
        kit.setWallet(id)
        ;({ address } = await withTimeout(
          guarded(id, () => kit.fetchAddress()),
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
      throw classifyWalletError(error, id)
    }
    if (!address) {
      throw new WalletError('locked', 'The wallet did not share an address', {
        walletId: id,
      })
    }
    return finishConnect(kit, address)
  }

  function accessOf(
    entry: WalletCatalogEntry | undefined,
    id: string,
    kitAvailable: boolean
  ): WalletAccess {
    if (unavailableReason(entry, page)) return 'unavailable'
    if (entry?.kind === 'extension-or-web') {
      return id === WALLET_IDS.xbull && page.hasXbullExtension()
        ? 'installed'
        : 'web'
    }
    if (entry && WINDOW_KINDS.has(entry.kind)) {
      return kitAvailable ? 'web' : 'unavailable'
    }
    return kitAvailable ? 'installed' : 'not-installed'
  }

  /**
   * Supported wallets, in the kit's order, and how each can be used in this
   * browser (`access`).
   */
  async function listWallets(): Promise<WalletOption[]> {
    const { kit } = await init()
    const wallets = await kit.refreshSupportedWallets()
    return wallets.map(({ id, name, isAvailable, url, icon }) => {
      const entry = walletEntry(id)
      const access = accessOf(entry, id, isAvailable)
      return {
        id,
        name: entry?.name ?? name,
        isAvailable: access === 'installed' || access === 'web',
        url: entry?.url ?? url,
        // Only icons `img-src` allows: the kit CDN, or a module's data: URL.
        icon: entry?.icon ?? (icon?.startsWith('data:') ? icon : undefined),
        access,
        kind: entry?.kind ?? 'extension',
        ...(entry?.formerly ? { formerly: entry.formerly } : {}),
        ...(access === 'unavailable'
          ? { unavailableReason: unavailableReason(entry, page) }
          : {}),
      }
    })
  }

  /**
   * True when an installed wallet is available, or WalletConnect is
   * configured (mobile wallets connect through it without an extension).
   * Web wallets alone do not count.
   */
  async function hasWallet(): Promise<boolean> {
    const { modules } = await init()
    if (modules.some((m) => m.productId === WALLET_IDS.walletConnect)) {
      return true
    }
    const wallets = await listWallets()
    return wallets.some((w) => w.access === 'installed')
  }

  /**
   * Refuses before prompting when the connected wallet cannot sign `xdr`
   * (a Soroban envelope for a wallet that signs classic ones only).
   */
  async function assertCanSign(current: WalletConnection, xdr: string) {
    const entry = walletEntry(current.walletId)
    if (!entry || entry.capabilities.soroban || !options.describeEnvelope) {
      return
    }
    const { soroban } = await options.describeEnvelope(xdr)
    if (soroban) {
      throw new WalletError(
        'unsupported',
        `${entry.name} cannot sign Soroban contract calls, which this payment uses. Connect another wallet, such as Varial or xBull.`,
        { walletId: current.walletId }
      )
    }
  }

  /**
   * For a wallet that cannot report its network: the signature must be the
   * connected address's, for QuillTip's passphrase.
   */
  async function assertSignedForNetwork(
    current: WalletConnection,
    signedTxXdr: string,
    address: string
  ) {
    if (current.networkReported || !options.verifySignature) return
    let check: SignatureCheck
    try {
      check = await options.verifySignature(signedTxXdr, address, expected)
    } catch (error) {
      throw new WalletError(
        'failed',
        'The wallet returned an unreadable transaction',
        {
          walletId: current.walletId,
          cause: error,
        }
      )
    }
    if (check === 'wrong-network') {
      throw new WalletError('wrong-network', SIGNED_FOR_ANOTHER_NETWORK, {
        walletId: current.walletId,
        expectedPassphrase: expected,
      })
    }
    if (check === 'wrong-account') {
      throw new WalletError(
        'wrong-account',
        'The wallet signed with a different account',
        { walletId: current.walletId }
      )
    }
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
      await assertCanSign(current, xdr)
      let result: { signedTxXdr: string; signerAddress?: string }
      try {
        result = await withTimeout(
          guarded(current.walletId, () =>
            kit.signTransaction(xdr, { address, networkPassphrase: expected })
          ),
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
      await assertSignedForNetwork(current, result.signedTxXdr, address)
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
          guarded(current.walletId, () =>
            kit.signMessage(message, {
              address: current.address,
              networkPassphrase: expected,
            })
          ),
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
