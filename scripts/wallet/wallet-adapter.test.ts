import { afterEach, describe, expect, test, vi } from 'vitest'
import type { ModuleInterface } from '@creit.tech/stellar-wallets-kit/types'
import {
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
import { formatTipFailureMessage } from '../../lib/stellar/tip-error-messages'

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

  test('tip failures use the wallet copy', () => {
    expect(
      formatTipFailureMessage(new WalletError('rejected', 'User declined'))
    ).toEqual({
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
