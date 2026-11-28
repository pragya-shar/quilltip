import { afterEach, describe, expect, test, vi } from 'vitest'
import type { ModuleInterface } from '@creit.tech/stellar-wallets-kit/types'
import {
  RESTORE_TIMEOUT_MS,
  classifyWalletError,
  createWalletAdapter,
  type KitBundle,
  type KitFacade,
} from '../../lib/stellar/v2/wallet'
import {
  WalletError,
  describeConnectFailure,
  isWalletError,
  walletErrorMessage,
  type WalletErrorKind,
} from '../../lib/stellar/v2/wallet-errors'

const TESTNET = 'Test SDF Network ; September 2015'
const PUBLIC = 'Public Global Stellar Network ; September 2015'
const ADDRESS = 'GBZXN7PIRZGNMHGA7MUUUF4GWPY5AYPV6LY4UV2GL6VJGIQRXFDNMADI'
const OTHER = 'GCS5XCIKIBZ3L5CUKJMMAG6IUBBNCCPT5SFTXFW5I4DZOMT4RJ43DUAR'

function moduleStub(id: string, name = id): ModuleInterface {
  return { productId: id, productName: name } as unknown as ModuleInterface
}

/** A fake of the kit's static API. Each test sets the behaviour it needs. */
function fakeKit(
  opts: {
    modules?: string[]
    available?: string[]
    walletNetwork?: string | 'unsupported'
  } = {}
) {
  const modules = (opts.modules ?? ['varial', 'xbull', 'albedo']).map((id) =>
    moduleStub(id, id === 'varial' ? 'Varial' : id)
  )
  const handlers = new Map<string, (event: unknown) => void>()
  let selected = modules[0]!
  const state = { walletNetwork: opts.walletNetwork ?? TESTNET }
  const kit = {
    init: vi.fn(),
    setWallet: vi.fn((id: string) => {
      selected = modules.find((m) => m.productId === id)!
    }),
    authModal: vi.fn(async () => ({ address: ADDRESS })),
    fetchAddress: vi.fn(async () => ({ address: ADDRESS })),
    getNetwork: vi.fn(async () => {
      if (state.walletNetwork === 'unsupported') {
        throw {
          code: -3,
          message: 'xBull does not support the "getNetwork" function',
        }
      }
      return { network: 'TESTNET', networkPassphrase: state.walletNetwork }
    }),
    signTransaction: vi.fn(async (xdr: string) => ({
      signedTxXdr: `${xdr}:signed`,
      signerAddress: ADDRESS,
    })),
    signMessage: vi.fn(async (message: string) => ({
      signedMessage: `${message}:signed`,
      signerAddress: ADDRESS,
    })),
    disconnect: vi.fn(async () => {}),
    refreshSupportedWallets: vi.fn(async () =>
      modules.map((m) => ({
        id: m.productId,
        name: m.productName,
        type: 'HOT_WALLET',
        isAvailable: (opts.available ?? ['varial']).includes(m.productId),
        isPlatformWrapper: false,
        icon: '',
        url: '',
      }))
    ),
    on: vi.fn((type: string, callback: (event: unknown) => void) => {
      handlers.set(type, callback)
      return () => handlers.delete(type)
    }),
    get selectedModule() {
      return selected
    },
  } satisfies KitFacade
  const bundle: KitBundle = {
    kit,
    modules,
    events: { stateUpdated: 'STATE_UPDATE', disconnect: 'DISCONNECT' },
  }
  return {
    kit,
    bundle,
    state,
    fire: (type: string, event: unknown) => handlers.get(type)?.(event),
  }
}

function adapterFor(
  fake: ReturnType<typeof fakeKit>,
  extra: Partial<Parameters<typeof createWalletAdapter>[0]> = {}
) {
  return createWalletAdapter({
    loadKit: async () => fake.bundle,
    networkPassphrase: TESTNET,
    storage: null,
    ...extra,
  })
}

async function rejection(promise: Promise<unknown>): Promise<WalletError> {
  try {
    await promise
  } catch (error) {
    if (error instanceof WalletError) return error
    throw error
  }
  throw new Error('Expected a WalletError')
}

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('init', () => {
  test('refuses to build an adapter for Stellar mainnet', () => {
    expect(() =>
      createWalletAdapter({
        loadKit: async () => fakeKit().bundle,
        networkPassphrase: 'Public Global Stellar Network ; September 2015',
        storage: null,
      })
    ).toThrow(/does not sign for Stellar mainnet/)
  })

  test('initialises the kit once with the configured network and theme', async () => {
    const fake = fakeKit()
    const theme = { primary: '#790333' } as never
    const wallet = adapterFor(fake, { theme })
    await Promise.all([wallet.init(), wallet.init(), wallet.hasWallet()])
    expect(fake.kit.init).toHaveBeenCalledTimes(1)
    expect(fake.kit.init.mock.calls[0]![0]).toMatchObject({
      network: TESTNET,
      theme,
      modules: fake.bundle.modules,
    })
    expect(fake.kit.on).toHaveBeenCalledWith(
      'STATE_UPDATE',
      expect.any(Function)
    )
  })

  test('moves a stored 1.x Freighter choice to Varial and removes the old key', async () => {
    const fake = fakeKit()
    const store = new Map([['selectedWalletId', 'freighter']])
    const storage = {
      getItem: (key: string) => store.get(key) ?? null,
      removeItem: (key: string) => void store.delete(key),
    }
    await adapterFor(fake, { storage }).init()
    expect(fake.kit.init.mock.calls[0]![0]).toMatchObject({
      selectedWalletId: 'varial',
    })
    expect(store.has('selectedWalletId')).toBe(false)
  })

  test('lists a wallet that needs https as unavailable on http, with the reason, and never prompts it', async () => {
    vi.stubGlobal('window', {
      location: { protocol: 'http:', hostname: 'localhost' },
    })
    const fake = fakeKit({
      modules: ['varial', 'albedo', 'LEDGER'],
      available: ['varial', 'albedo', 'LEDGER'],
    })
    const wallet = adapterFor(fake)
    await wallet.init()
    const ids = fake.kit.init.mock.calls[0]![0].modules.map(
      (m: ModuleInterface) => m.productId
    )
    expect(ids).toEqual(['varial', 'albedo', 'LEDGER'])
    const list = await wallet.listWallets()
    // Albedo answers http pages (checked against albedo.link from
    // http://127.0.0.1), so it stays usable.
    expect(list.find((w) => w.id === 'albedo')?.access).toBe('web')
    expect(list.find((w) => w.id === 'LEDGER')).toMatchObject({
      access: 'unavailable',
      isAvailable: false,
      unavailableReason:
        'Ledger works only on a secure (https) page, and this page uses http.',
    })
    const error = await rejection(wallet.connect({ walletId: 'LEDGER' }))
    expect(error.kind).toBe('unsupported')
    expect(fake.kit.fetchAddress).not.toHaveBeenCalled()
  })
})

describe('connect', () => {
  test('opens authModal and records the wallet, address and network', async () => {
    const fake = fakeKit()
    const wallet = adapterFor(fake)
    const events: string[] = []
    wallet.subscribe((event) => events.push(event.type))
    await expect(wallet.connect()).resolves.toEqual({
      address: ADDRESS,
      walletId: 'varial',
      walletName: 'Varial',
      network: 'TESTNET',
      networkPassphrase: TESTNET,
      networkReported: true,
    })
    expect(fake.kit.authModal).toHaveBeenCalledTimes(1)
    expect(wallet.getConnection()?.address).toBe(ADDRESS)
    expect(events).toEqual(['connected'])
  })

  test('concurrent calls share one picker', async () => {
    const fake = fakeKit()
    const wallet = adapterFor(fake)
    const [a, b] = await Promise.all([wallet.connect(), wallet.connect()])
    expect(a).toBe(b)
    expect(fake.kit.authModal).toHaveBeenCalledTimes(1)
  })

  test('no wallet: only web wallets are available', async () => {
    const fake = fakeKit({ available: ['xbull', 'albedo'] })
    const error = await rejection(adapterFor(fake).connect())
    expect(error.kind).toBe('no-wallet')
    expect(fake.kit.authModal).not.toHaveBeenCalled()
    expect(describeConnectFailure(error)).toEqual({ action: 'install' })
  })

  test('WalletConnect counts as a wallet when configured', async () => {
    const fake = fakeKit({
      modules: ['varial', 'wallet_connect'],
      available: [],
    })
    await expect(adapterFor(fake).hasWallet()).resolves.toBe(true)
  })

  test('closing the picker is cancelled, not an error to show', async () => {
    const fake = fakeKit()
    fake.kit.authModal.mockRejectedValueOnce({
      code: -1,
      message: 'The user closed the modal.',
    })
    const error = await rejection(adapterFor(fake).connect())
    expect(error.kind).toBe('cancelled')
    expect(describeConnectFailure(error)).toEqual({ action: 'ignore' })
  })

  test('locked wallet: access not granted', async () => {
    const fake = fakeKit()
    fake.kit.authModal.mockRejectedValueOnce({
      code: -3,
      message:
        'Getting the address from Varial is not allowed, please request access first.',
    })
    expect((await rejection(adapterFor(fake).connect())).kind).toBe('locked')
  })

  test('locked wallet: no address returned', async () => {
    const fake = fakeKit()
    fake.kit.authModal.mockResolvedValueOnce({ address: '' })
    expect((await rejection(adapterFor(fake).connect())).kind).toBe('locked')
  })

  test('wrong network is refused and leaves no connection', async () => {
    const fake = fakeKit({ walletNetwork: PUBLIC })
    const wallet = adapterFor(fake)
    const error = await rejection(wallet.connect())
    expect(error).toMatchObject({
      kind: 'wrong-network',
      expectedPassphrase: TESTNET,
      walletPassphrase: PUBLIC,
    })
    expect(wallet.getConnection()).toBeNull()
    expect(walletErrorMessage(error)?.title).toBe(
      'Switch your wallet to Testnet'
    )
    expect(walletErrorMessage(error)?.detail).toContain(
      'Your wallet is on Mainnet'
    )
  })

  test('a wallet that cannot report its network connects for Quilltip’s network', async () => {
    const fake = fakeKit({ walletNetwork: 'unsupported' })
    await expect(adapterFor(fake).connect()).resolves.toMatchObject({
      networkPassphrase: TESTNET,
      networkReported: false,
      network: '',
    })
  })

  test('connects one wallet by ID, mapping the 1.x Freighter ID', async () => {
    const fake = fakeKit()
    const connection = await adapterFor(fake).connect({ walletId: 'freighter' })
    expect(fake.kit.setWallet).toHaveBeenCalledWith('varial')
    expect(fake.kit.fetchAddress).toHaveBeenCalled()
    expect(fake.kit.authModal).not.toHaveBeenCalled()
    expect(connection.walletId).toBe('varial')
  })

  test('connecting by ID times out when the wallet never answers', async () => {
    vi.useFakeTimers()
    const fake = fakeKit()
    fake.kit.fetchAddress.mockReturnValueOnce(new Promise(() => {}))
    const pending = rejection(
      adapterFor(fake, { connectTimeoutMs: 1000 }).connect({
        walletId: 'xbull',
      })
    )
    await vi.advanceTimersByTimeAsync(1000)
    expect((await pending).kind).toBe('timeout')
  })
})

describe('signMessage', () => {
  test('signs with the connected address for Quilltip’s network', async () => {
    const fake = fakeKit()
    const wallet = adapterFor(fake)
    await wallet.connect()
    await expect(wallet.signMessage('hello')).resolves.toEqual({
      signedMessage: 'hello:signed',
      signerAddress: ADDRESS,
    })
    expect(fake.kit.signMessage).toHaveBeenCalledWith('hello', {
      address: ADDRESS,
      networkPassphrase: TESTNET,
    })
  })

  test('reports wallets that cannot sign messages as unsupported', async () => {
    const fake = fakeKit()
    const wallet = adapterFor(fake)
    await wallet.connect()
    fake.kit.signMessage.mockRejectedValueOnce({
      code: -3,
      message: 'Albedo does not support the "signMessage" function',
    })
    expect((await rejection(wallet.signMessage('hello'))).kind).toBe(
      'unsupported'
    )
  })

  test('refuses another account’s signature and a wrong network', async () => {
    const fake = fakeKit()
    const wallet = adapterFor(fake)
    await wallet.connect()
    fake.kit.signMessage.mockResolvedValueOnce({
      signedMessage: 'x',
      signerAddress: OTHER,
    })
    expect((await rejection(wallet.signMessage('hello'))).kind).toBe(
      'wrong-account'
    )
    fake.state.walletNetwork = PUBLIC
    expect((await rejection(wallet.signMessage('hello'))).kind).toBe(
      'wrong-network'
    )
  })
})

describe('signTransaction', () => {
  test('signs for Quilltip’s network with the connected address', async () => {
    const fake = fakeKit()
    const wallet = adapterFor(fake)
    await wallet.connect()
    await expect(wallet.signTransaction('AAAA')).resolves.toEqual({
      signedTxXdr: 'AAAA:signed',
      signerAddress: ADDRESS,
    })
    expect(fake.kit.signTransaction).toHaveBeenCalledWith('AAAA', {
      address: ADDRESS,
      networkPassphrase: TESTNET,
    })
  })

  test('needs a connection first', async () => {
    const error = await rejection(adapterFor(fakeKit()).signTransaction('AAAA'))
    expect(error.kind).toBe('locked')
  })

  test('refuses before prompting when the wallet moved to another network', async () => {
    const fake = fakeKit()
    const wallet = adapterFor(fake)
    await wallet.connect()
    fake.state.walletNetwork = PUBLIC
    const error = await rejection(wallet.signTransaction('AAAA'))
    expect(error.kind).toBe('wrong-network')
    expect(fake.kit.signTransaction).not.toHaveBeenCalled()
  })

  test.each([
    [{ code: -4, message: 'User declined access' }, 'rejected'],
    [new Error('Transaction rejected by user'), 'rejected'],
    [{ error: { code: -1, message: 'The wallet is locked' } }, 'locked'],
    [{ code: -1, message: 'Varial is not connected' }, 'no-wallet'],
    [{ code: -2, message: 'Request timed out' }, 'timeout'],
    ['Something broke', 'failed'],
  ] as const)('maps %o to %s', async (thrown, kind) => {
    const fake = fakeKit()
    const wallet = adapterFor(fake)
    await wallet.connect()
    fake.kit.signTransaction.mockRejectedValueOnce(thrown)
    expect((await rejection(wallet.signTransaction('AAAA'))).kind).toBe(kind)
  })

  test('times out when the wallet never answers', async () => {
    vi.useFakeTimers()
    const fake = fakeKit()
    const wallet = adapterFor(fake, { signTimeoutMs: 5000 })
    await wallet.connect()
    fake.kit.signTransaction.mockReturnValueOnce(new Promise(() => {}))
    const pending = rejection(wallet.signTransaction('AAAA'))
    await vi.advanceTimersByTimeAsync(5000)
    const error = await pending
    expect(error.kind).toBe('timeout')
    expect(walletErrorMessage(error)?.title).toBe('Your wallet did not respond')
  })

  test('refuses a signature from another account', async () => {
    const fake = fakeKit()
    const wallet = adapterFor(fake)
    await wallet.connect()
    fake.kit.signTransaction.mockResolvedValueOnce({
      signedTxXdr: 'AAAA:signed',
      signerAddress: OTHER,
    })
    expect((await rejection(wallet.signTransaction('AAAA'))).kind).toBe(
      'wrong-account'
    )
  })

  test('another signer after the wallet answered names the caller’s linked signer, only when the caller gave one (#582)', async () => {
    const fake = fakeKit()
    const wallet = adapterFor(fake)
    await wallet.connect()
    fake.kit.signTransaction.mockResolvedValue({
      signedTxXdr: 'AAAA:signed',
      signerAddress: OTHER,
    })
    const named = await rejection(
      wallet.signTransaction('AAAA', { address: ADDRESS })
    )
    expect(named).toMatchObject({
      kind: 'wrong-account',
      expectedAddress: ADDRESS,
    })
    expect(named.walletAddress).toBeUndefined()
    expect(walletErrorMessage(named)?.detail).toBe(
      'Switch your wallet to GBZX…MADI, the address linked to your Quilltip account, or reconnect. Nothing was sent.'
    )
    const unnamed = await rejection(wallet.signTransaction('AAAA'))
    expect(unnamed.expectedAddress).toBeUndefined()
    expect(walletErrorMessage(unnamed)?.detail).toBe(
      'Switch back to the connected account in your wallet, or reconnect. Nothing was sent.'
    )
  })

  test('a wrong account found before signing keeps its sentence in walletErrorMessage, though it names the linked signer (#582)', () => {
    const before = new WalletError(
      'wrong-account',
      'The wallet is on another account than the one that signs',
      { walletId: 'varial', expectedAddress: ADDRESS, walletAddress: OTHER }
    )
    expect(walletErrorMessage(before)?.detail).toBe(
      'Switch back to the connected account in your wallet, or reconnect. Nothing was sent.'
    )
  })

  test('a signature by another account, found by the signature check, names the linked signer (#582)', async () => {
    const fake = fakeKit({ walletNetwork: 'unsupported' })
    const wallet = adapterFor(fake, {
      verifySignature: async () => 'wrong-account',
    })
    await wallet.connect({ walletId: 'xbull' })
    fake.kit.signTransaction.mockResolvedValue({
      signedTxXdr: 'AAAA:signed',
      signerAddress: ADDRESS,
    })
    expect(
      await rejection(wallet.signTransaction('AAAA', { address: ADDRESS }))
    ).toMatchObject({ kind: 'wrong-account', expectedAddress: ADDRESS })
    expect(
      (await rejection(wallet.signTransaction('AAAA'))).expectedAddress
    ).toBeUndefined()
  })

  test('refuses an empty signature', async () => {
    const fake = fakeKit()
    const wallet = adapterFor(fake)
    await wallet.connect()
    fake.kit.signTransaction.mockResolvedValueOnce({
      signedTxXdr: '',
      signerAddress: ADDRESS,
    })
    expect((await rejection(wallet.signTransaction('AAAA'))).kind).toBe(
      'failed'
    )
  })
})

describe('events and state', () => {
  test('kit events update the account and disconnect', async () => {
    const fake = fakeKit()
    const wallet = adapterFor(fake)
    const seen: unknown[] = []
    wallet.subscribe((event) => seen.push(event))
    await wallet.connect()
    fake.fire('STATE_UPDATE', { payload: { address: OTHER } })
    expect(wallet.getConnection()?.address).toBe(OTHER)
    fake.fire('DISCONNECT', { payload: {} })
    expect(wallet.getConnection()).toBeNull()
    expect(seen.map((e) => (e as { type: string }).type)).toEqual([
      'connected',
      'account',
      'disconnected',
    ])
  })

  test('refreshNetwork reports a network change, then refuses it', async () => {
    const fake = fakeKit()
    const wallet = adapterFor(fake)
    const seen: string[] = []
    await wallet.connect()
    wallet.subscribe((event) => seen.push(event.type))
    fake.state.walletNetwork = PUBLIC
    expect((await rejection(wallet.refreshNetwork())).kind).toBe(
      'wrong-network'
    )
    expect(seen).toEqual(['network'])
    expect(wallet.getConnection()?.networkPassphrase).toBe(PUBLIC)
  })

  test('disconnect clears the connection and closes the kit session', async () => {
    const fake = fakeKit()
    const wallet = adapterFor(fake)
    await wallet.connect()
    await wallet.disconnect()
    expect(wallet.getConnection()).toBeNull()
    expect(fake.kit.disconnect).toHaveBeenCalled()
  })
})

describe('copy', () => {
  const kinds: WalletErrorKind[] = [
    'no-wallet',
    'locked',
    'wrong-network',
    'rejected',
    'timeout',
    'unsupported',
    'wrong-account',
    'failed',
  ]
  test.each(kinds)('%s has a title and an action', (kind) => {
    const message = walletErrorMessage(new WalletError(kind, 'detail'))
    expect(message?.title).toBeTruthy()
    expect(message?.detail).toBeTruthy()
  })

  test('a declined request has the wallet copy', () => {
    expect(
      walletErrorMessage(new WalletError('rejected', 'User declined'))
    ).toMatchObject({
      title: 'Request declined in your wallet',
      detail:
        'Nothing was signed or sent. Try again and approve the request when you are ready.',
    })
  })

  test('classifyWalletError keeps an existing WalletError', () => {
    const error = new WalletError('locked', 'x')
    expect(classifyWalletError(error)).toBe(error)
    expect(isWalletError(error, 'locked')).toBe(true)
    expect(isWalletError(new Error('x'))).toBe(false)
  })
})

describe('the account before signing (#547)', () => {
  test('a Varial wallet that switched accounts is stopped before the signature, naming who signs', async () => {
    const fake = fakeKit()
    const varial = fake.bundle.modules[0] as unknown as {
      getAddress: (p?: { skipRequestAccess?: boolean }) => Promise<{
        address: string
      }>
    }
    varial.getAddress = vi.fn(async () => ({ address: OTHER }))
    const wallet = adapterFor(fake)
    await wallet.connect({ walletId: 'varial' })
    const events: unknown[] = []
    wallet.subscribe((event) => events.push(event))
    const error = await rejection(wallet.signTransaction('AAAA'))
    expect(error.kind).toBe('wrong-account')
    expect(error.expectedAddress).toBe(ADDRESS)
    expect(error.walletAddress).toBe(OTHER)
    // Read without a prompt, and no signature was requested.
    expect(varial.getAddress).toHaveBeenCalledWith({ skipRequestAccess: true })
    expect(fake.kit.signTransaction).not.toHaveBeenCalled()
    // The page now knows the wallet's account.
    expect(wallet.getConnection()?.address).toBe(OTHER)
    expect(events).toContainEqual({ type: 'account', address: OTHER })
  })

  test('the same account signs as before', async () => {
    const fake = fakeKit()
    ;(fake.bundle.modules[0] as unknown as Record<string, unknown>).getAddress =
      vi.fn(async () => ({ address: ADDRESS }))
    const wallet = adapterFor(fake)
    await wallet.connect({ walletId: 'varial' })
    await expect(wallet.signTransaction('AAAA')).resolves.toMatchObject({
      signedTxXdr: 'AAAA:signed',
    })
  })

  test('a wallet whose account read could prompt is not asked again', async () => {
    const fake = fakeKit({ available: ['varial', 'xbull'] })
    const read = vi.fn(async () => ({ address: OTHER }))
    ;(fake.bundle.modules[1] as unknown as Record<string, unknown>).getAddress =
      read
    const wallet = adapterFor(fake)
    await wallet.connect({ walletId: 'xbull' })
    await wallet.signTransaction('AAAA')
    expect(read).not.toHaveBeenCalled()
  })

  test('a signer other than the connected address is refused before signing', async () => {
    const fake = fakeKit()
    const wallet = adapterFor(fake)
    await wallet.connect({ walletId: 'varial' })
    const error = await rejection(
      wallet.signTransaction('AAAA', { address: OTHER })
    )
    expect(error).toMatchObject({
      kind: 'wrong-account',
      expectedAddress: OTHER,
      walletAddress: ADDRESS,
    })
    expect(fake.kit.signTransaction).not.toHaveBeenCalled()
  })
})

describe('restore after a page load (#562)', () => {
  const KIT_KEY = '@StellarWalletsKit/selectedModuleId'
  const KEY = 'quilltip:wallet:v1:reader-1'
  const record = (walletId: string, address = ADDRESS) =>
    JSON.stringify({ walletId, address })

  function memory(initial: Record<string, string> = {}) {
    const store = new Map(Object.entries(initial))
    return {
      store,
      storage: {
        getItem: (key: string) => store.get(key) ?? null,
        setItem: (key: string, value: string) => void store.set(key, value),
        removeItem: (key: string) => void store.delete(key),
      },
    }
  }

  /** Every offered wallet, each with a `getAddress` the test watches. */
  function restoreKit(
    read = vi.fn(async (_params?: { skipRequestAccess?: boolean }) => ({
      address: ADDRESS,
    }))
  ) {
    const fake = fakeKit({
      modules: [
        'varial',
        'xbull',
        'rabet',
        'hana',
        'scopuly',
        'dcent',
        'albedo',
        'lobstr',
      ],
    })
    for (const m of fake.bundle.modules) Object.assign(m, { getAddress: read })
    return { fake, read }
  }

  function restoring(
    fake: ReturnType<typeof fakeKit>,
    mem: ReturnType<typeof memory>
  ) {
    const wallet = adapterFor(fake, { storage: mem.storage })
    wallet.setRemembering('reader-1')
    return wallet
  }

  test('reconnects a remembered Varial with one read that cannot prompt', async () => {
    const { fake, read } = restoreKit()
    const mem = memory({ [KEY]: record('varial') })
    const wallet = restoring(fake, mem)
    const events: unknown[] = []
    wallet.subscribe((event) => events.push(event))
    const connection = await wallet.restore()
    expect(connection).toMatchObject({
      address: ADDRESS,
      walletId: 'varial',
      networkPassphrase: TESTNET,
      networkReported: true,
    })
    expect(read).toHaveBeenCalledTimes(1)
    expect(read).toHaveBeenCalledWith({ skipRequestAccess: true })
    expect(fake.kit.fetchAddress).not.toHaveBeenCalled()
    expect(fake.kit.authModal).not.toHaveBeenCalled()
    expect(events).toEqual([{ type: 'connected', connection, restored: true }])
  })

  test('remembers the choice only while a reader is signed in', async () => {
    const fake = fakeKit()
    const mem = memory()
    const wallet = adapterFor(fake, { storage: mem.storage })
    await wallet.connect({ walletId: 'varial' })
    expect(mem.store.has(KEY)).toBe(false)
    wallet.setRemembering('reader-1')
    expect(mem.store.get(KEY)).toBe(record('varial'))
    // No reader: the kit's copy goes; the reader's own record stays theirs
    // (sign-out removes it through \`disconnect\`).
    mem.store.set(KIT_KEY, 'varial')
    wallet.setRemembering(null)
    expect([...mem.store.keys()]).toEqual([KEY])
    await wallet.disconnect()
    await wallet.connect({ walletId: 'varial' })
    expect([...mem.store.keys()]).toEqual([KEY])
  })

  test('a kit that starts with no reader signed in leaves no copy behind', async () => {
    // The kit writes its keys when it starts; sign-out may already have
    // cleared storage by then (#554).
    const fake = fakeKit()
    const mem = memory()
    fake.kit.init.mockImplementation(() => {
      mem.store.set(KIT_KEY, 'varial')
      mem.store.set('@StellarWalletsKit/hardwareWalletPaths', '[]')
      mem.store.set('@StellarWalletsKit/wcSessionPaths', '[]')
    })
    const wallet = adapterFor(fake, { storage: mem.storage })
    wallet.setRemembering(null)
    await wallet.init()
    expect([...mem.store.keys()]).toEqual([])
  })

  test('a kit that starts for a signed-in reader keeps its keys', async () => {
    const fake = fakeKit()
    const mem = memory({ [KEY]: record('varial') })
    fake.kit.init.mockImplementation(() => {
      mem.store.set(KIT_KEY, 'varial')
    })
    const wallet = adapterFor(fake, { storage: mem.storage })
    wallet.setRemembering('reader-1')
    await wallet.init()
    expect(mem.store.get(KIT_KEY)).toBe('varial')
    expect(mem.store.get(KEY)).toBe(record('varial'))
  })

  test('signed out: does not restore and asks nothing', async () => {
    const { fake, read } = restoreKit()
    const mem = memory({ [KEY]: record('varial') })
    const wallet = adapterFor(fake, { storage: mem.storage })
    await expect(wallet.restore()).resolves.toBeNull()
    expect(read).not.toHaveBeenCalled()
  })

  for (const walletId of [
    'xbull',
    'rabet',
    'hana',
    'scopuly',
    'dcent',
    'albedo',
  ]) {
    test(`${walletId} could prompt: not asked, the choice kept`, async () => {
      const { fake, read } = restoreKit()
      const mem = memory({ [KEY]: record(walletId) })
      const wallet = restoring(fake, mem)
      await expect(wallet.restore()).resolves.toBeNull()
      expect(read).not.toHaveBeenCalled()
      expect(fake.kit.setWallet).not.toHaveBeenCalled()
      expect(mem.store.get(KEY)).toBe(record(walletId))
    })
  }

  for (const [name, stored] of [
    ['an unknown wallet', record('evil')],
    ['a wallet Quilltip does not offer', record('lobstr')],
    ['an address that is not an account ID', record('varial', 'GABC')],
    [
      'an extra field',
      JSON.stringify({ walletId: 'varial', address: ADDRESS, x: 1 }),
    ],
    ['not JSON', 'varial'],
  ] as const) {
    test(`tampered record, ${name}: no module selected, the record removed`, async () => {
      const { fake, read } = restoreKit()
      const mem = memory({ [KEY]: stored })
      const wallet = restoring(fake, mem)
      await expect(wallet.restore()).resolves.toBeNull()
      expect(fake.kit.setWallet).not.toHaveBeenCalled()
      expect(read).not.toHaveBeenCalled()
      expect(mem.store.has(KEY)).toBe(false)
    })
  }

  test('access revoked: the read fails, the wallet stays disconnected', async () => {
    const { fake } = restoreKit(
      vi.fn(async () => {
        throw {
          code: -3,
          message:
            'Getting the address from Varial is not allowed, please request access first.',
        }
      })
    )
    const mem = memory({ [KEY]: record('varial') })
    const wallet = restoring(fake, mem)
    await expect(wallet.restore()).resolves.toBeNull()
    expect(wallet.getConnection()).toBeNull()
    expect(fake.kit.fetchAddress).not.toHaveBeenCalled()
  })

  test('a wallet that never answers: gives up without a prompt', async () => {
    vi.useFakeTimers()
    const { fake } = restoreKit(vi.fn(() => new Promise<never>(() => {})))
    const mem = memory({ [KEY]: record('varial') })
    const wallet = restoring(fake, mem)
    const result = wallet.restore()
    await vi.advanceTimersByTimeAsync(RESTORE_TIMEOUT_MS)
    await expect(result).resolves.toBeNull()
  })

  test('account changed since the last visit: stays disconnected, the remembered wallet kept as last used', async () => {
    const { fake, read } = restoreKit()
    const mem = memory({ [KEY]: record('varial', OTHER) })
    const wallet = restoring(fake, mem)
    await expect(wallet.restore()).resolves.toBeNull()
    expect(read).toHaveBeenCalledWith({ skipRequestAccess: true })
    expect(wallet.getConnection()).toBeNull()
    expect(wallet.rememberedWallet()).toEqual({
      walletId: 'varial',
      address: OTHER,
    })
  })

  test('each reader has their own record; another reader’s is not read', async () => {
    const { fake, read } = restoreKit()
    const mem = memory({
      'quilltip:wallet:v1:reader-2': record('varial'),
    })
    const wallet = restoring(fake, mem)
    await expect(wallet.restore()).resolves.toBeNull()
    expect(read).not.toHaveBeenCalled()
    await wallet.connect({ walletId: 'varial' })
    expect(mem.store.get(KEY)).toBe(record('varial'))
    expect(mem.store.get('quilltip:wallet:v1:reader-2')).toBe(record('varial'))
  })

  test('a restored wallet on another account than the linked one is refused before it is asked to sign', async () => {
    const { fake } = restoreKit()
    const mem = memory({ [KEY]: record('varial') })
    const wallet = restoring(fake, mem)
    await wallet.restore()
    const error = await rejection(
      wallet.signTransaction('XDR', { address: OTHER })
    )
    expect(error.kind).toBe('wrong-account')
    expect(fake.kit.signTransaction).not.toHaveBeenCalled()
  })

  test('wrong network: restored with the wallet’s network, and signing refused before the wallet is asked', async () => {
    const { fake } = restoreKit()
    fake.state.walletNetwork = PUBLIC
    const mem = memory({ [KEY]: record('varial') })
    const wallet = restoring(fake, mem)
    await expect(wallet.restore()).resolves.toMatchObject({
      networkPassphrase: PUBLIC,
    })
    const error = await rejection(wallet.signTransaction('XDR'))
    expect(error.kind).toBe('wrong-network')
    expect(fake.kit.signTransaction).not.toHaveBeenCalled()
  })

  test('Disconnect forgets the choice and the kit’s copy; nothing restores after it', async () => {
    const { fake, read } = restoreKit()
    const mem = memory({ [KEY]: record('varial') })
    const wallet = restoring(fake, mem)
    await wallet.restore()
    mem.store.set(KIT_KEY, 'varial')
    await wallet.disconnect()
    expect([...mem.store.keys()]).toEqual([])
    await expect(wallet.restore()).resolves.toBeNull()
    expect(read).toHaveBeenCalledTimes(1)
  })

  test('Disconnect with no wallet connected still forgets the choice', async () => {
    const { fake } = restoreKit(
      vi.fn(async () => {
        throw { code: -3, message: 'not allowed' }
      })
    )
    const mem = memory({ [KEY]: record('varial') })
    const wallet = restoring(fake, mem)
    await wallet.restore()
    await wallet.disconnect()
    expect(mem.store.has(KEY)).toBe(false)
  })

  test('the wallet ending the session forgets the choice', async () => {
    const { fake } = restoreKit()
    const mem = memory({ [KEY]: record('varial') })
    const wallet = restoring(fake, mem)
    await wallet.restore()
    fake.fire('DISCONNECT', {})
    expect(mem.store.has(KEY)).toBe(false)
  })

  test('a connect by the reader while the wallet answers wins', async () => {
    let answer: (value: { address: string }) => void = () => {}
    const { fake } = restoreKit(
      vi.fn(
        () =>
          new Promise<{ address: string }>((resolve) => {
            answer = resolve
          })
      )
    )
    const mem = memory({ [KEY]: record('varial', OTHER) })
    const wallet = restoring(fake, mem)
    const restored = wallet.restore()
    await vi.waitFor(() => expect(fake.kit.setWallet).toHaveBeenCalled())
    await wallet.connect({ walletId: 'varial' })
    answer({ address: OTHER })
    await restored
    expect(wallet.getConnection()?.address).toBe(ADDRESS)
  })
})
