/**
 * Per-wallet behaviour (#511): the error mapping for each wallet Quilltip
 * offers, how each one is listed, blocked pop-ups, the Soroban capability
 * gate, and the signature check for wallets that cannot report a network.
 *
 * Error shapes are what each kit module rejects with: the kit's `parseError`
 * turns every wallet error into `{ code, message }` (SEP-43 codes: -1
 * internal, -2 external, -3 invalid request, -4 rejected by the user).
 */
import { afterEach, describe, expect, test, vi } from 'vitest'
import type { ModuleInterface } from '@creit.tech/stellar-wallets-kit/types'
import {
  Account,
  Keypair,
  Networks,
  Operation,
  TransactionBuilder,
} from '@stellar/stellar-sdk'
import {
  POPUP_CLOSED_GRACE_MS,
  POPUP_POLL_MS,
  createWalletAdapter,
  watchPopups,
  type KitBundle,
  type KitFacade,
  type WalletPage,
} from '../../lib/stellar/v2/wallet'
import {
  WALLET_ERROR_RULES,
  WalletError,
  classifyWalletError,
  walletErrorMessage,
  type WalletErrorKind,
} from '../../lib/stellar/v2/wallet-errors'
import {
  checkSourceSignature,
  describeEnvelope,
} from '../../lib/stellar/v2/wallet-signature'
import {
  OFFERED_WALLETS,
  WALLET_CATALOG,
  walletEntry,
} from '../../lib/stellar/wallet-catalog'

const TESTNET = Networks.TESTNET
const KEY = Keypair.random()
const ADDRESS = KEY.publicKey()

afterEach(() => {
  vi.useRealTimers()
})

describe('catalog', () => {
  test('offers the wallets the kit loads, each with a link and an icon', () => {
    expect(OFFERED_WALLETS.map((w) => w.id)).toEqual([
      'varial',
      'xbull',
      'rabet',
      'hana',
      'scopuly',
      'dcent',
      'albedo',
      // Listed only when a WalletConnect project ID is configured.
      'wallet_connect',
    ])
    for (const entry of WALLET_CATALOG) {
      expect(entry.url).toMatch(/^https:\/\//)
      if (entry.icon) {
        expect(entry.icon).toMatch(
          /^https:\/\/stellar\.creit\.tech\/wallet-icons\//
        )
      }
      if (!entry.offered) expect(entry.notOfferedReason).toBeTruthy()
    }
  })

  test('every offered wallet signs transactions and Soroban envelopes as the source account', () => {
    for (const entry of OFFERED_WALLETS) {
      expect(entry.capabilities.transaction).toBe(true)
      expect(entry.capabilities.soroban).toBe(true)
    }
  })

  test('the wallets that cannot sign for testnet are not offered', () => {
    for (const id of ['lobstr', 'hot-wallet', 'metamask', 'TREZOR', 'LEDGER']) {
      expect(walletEntry(id)?.offered).toBe(false)
    }
  })
})

/** [wallet, what its module rejects with, the app state]. */
const WALLET_ERRORS: [string, unknown, WalletErrorKind][] = [
  // Varial (@stellar/freighter-api 6)
  ['varial', { code: -4, message: 'User declined access' }, 'rejected'],
  [
    'varial',
    {
      code: -3,
      message:
        'Getting the address from Varial is not allowed, please request access first.',
    },
    'locked',
  ],
  ['varial', { code: -1, message: 'Varial is not connected' }, 'no-wallet'],
  [
    'varial',
    { code: -1, message: 'The user rejected this request.' },
    'rejected',
  ],
  // xBull: extension (window.xBullSDK) and web wallet (wallet.xbull.app)
  [
    'xbull',
    { code: -1, message: 'Request rejected from the wallet' },
    'rejected',
  ],
  ['xbull', { code: -1, message: 'no elements in sequence' }, 'rejected'],
  [
    'xbull',
    { code: -1, message: "xBull Wallet is not open, we can't connect with it" },
    'popup-blocked',
  ],
  [
    'xbull',
    {
      code: -3,
      message: 'xBull does not support the "signAuthEntry" function',
    },
    'unsupported',
  ],
  // Albedo (@albedo-link/intent)
  [
    'albedo',
    { code: -4, message: 'Action request was rejected by the user.' },
    'rejected',
  ],
  [
    'albedo',
    {
      code: -1,
      message:
        'Unhandled error occurred. If this error persists, please contact Albedo support.',
    },
    'failed',
  ],
  [
    'varial',
    {
      code: -1,
      message: 'The wallet is locked. Unlock Varial and try again.',
    },
    'locked',
  ],
  // Rabet (window.rabet)
  ['rabet', { code: -1, message: 'Rabet is not installed' }, 'no-wallet'],
  [
    'rabet',
    {
      code: -1,
      message:
        "Rabet doesn't support the network: Test SDF Future Network ; October 2022",
    },
    'wrong-network',
  ],
  ['rabet', { code: -1, message: 'User rejected the request.' }, 'rejected'],
  [
    'rabet',
    { code: -3, message: 'Rabet does not support the "signMessage" function' },
    'unsupported',
  ],
  // Hana (window.hanaWallet.stellar)
  ['hana', { code: -1, message: 'Hana Wallet is not installed' }, 'no-wallet'],
  ['hana', { code: -1, message: 'User rejected the request' }, 'rejected'],
  ['hana', { code: -1, message: 'Wallet is locked' }, 'locked'],
  // Scopuly (window.scopuly)
  [
    'scopuly',
    {
      code: -3,
      message:
        'Scopuly provider is not available. Install the Scopuly browser extension or open the dApp inside the Scopuly app.',
    },
    'no-wallet',
  ],
  ['scopuly', { code: -4, message: 'User rejected the request' }, 'rejected'],
  // D'CENT (window.dcentStellarProvider)
  [
    'dcent',
    { code: -1, message: "D'CENT Stellar provider is not available" },
    'no-wallet',
  ],
  [
    'dcent',
    {
      code: -3,
      message:
        "Getting the address from D'CENT is not allowed, please request access first.",
    },
    'locked',
  ],
  // Any wallet. SEP-43 -4 is a refusal even without refusal words; Hana and
  // Scopuly have no -4 rule of their own.
  ['hana', { code: -4, message: '' }, 'rejected'],
  ['scopuly', { code: -4, message: 'Transaction not signed' }, 'rejected'],
  ['varial', { code: -2, message: 'Request timed out' }, 'timeout'],
  ['xbull', 'Something broke', 'failed'],
]

describe('error mapping', () => {
  test.each(WALLET_ERRORS)('%s: %o is %s', (walletId, thrown, kind) => {
    const error = classifyWalletError(thrown, walletId)
    expect(error.kind).toBe(kind)
    expect(error.walletId).toBe(walletId)
  })

  test('each offered wallet has rules of its own; LOBSTR has none', () => {
    for (const id of OFFERED_WALLETS.map((w) => w.id)) {
      expect(WALLET_ERROR_RULES[id]?.length, id).toBeGreaterThan(0)
    }
    expect(WALLET_ERROR_RULES.lobstr).toBeUndefined()
  })

  test('a wallet’s own rule wins over the shared ones', () => {
    // Generic text would read "not open" as nothing; xBull's rule knows the
    // window never opened.
    expect(
      classifyWalletError(
        { message: "xBull Wallet is not open, we can't connect with it" },
        undefined
      ).kind
    ).toBe('failed')
  })

  test('copy names the wallet and the fix', () => {
    const message = (kind: WalletErrorKind, walletId: string) =>
      walletErrorMessage(new WalletError(kind, 'detail', { walletId }))
    expect(message('locked', 'hana')?.detail).toBe(
      'Unlock Hana, allow QuillTip to connect, then try again.'
    )
    expect(message('popup-blocked', 'albedo')).toEqual({
      title: 'Your browser blocked the wallet window',
      detail:
        'Albedo opens in a new window. Allow pop-ups for this site in your browser, then try again. Nothing was signed.',
    })
    expect(message('rejected', 'xbull')?.detail).toMatch(
      /^The xBull window was closed or the request was declined\. Nothing was signed or sent\./
    )
    expect(message('timeout', 'xbull')?.detail).toMatch(
      /Look for the xBull window behind this one/
    )
    expect(message('no-wallet', 'rabet')?.detail).toMatch(
      /^Rabet is not installed or not enabled in this browser/
    )
  })
})

function moduleStub(id: string): ModuleInterface {
  return {
    productId: id,
    productName: walletEntry(id)?.name ?? id,
  } as unknown as ModuleInterface
}

/** A fake kit whose wallet behaviour each test sets. */
function fakeKit(ids: string[], available: string[] = ids) {
  const modules = ids.map(moduleStub)
  let selected = modules[0]!
  const kit = {
    init: vi.fn(),
    setWallet: vi.fn((id: string) => {
      selected = modules.find((m) => m.productId === id)!
    }),
    authModal: vi.fn(async () => ({ address: ADDRESS })),
    fetchAddress: vi.fn(async () => ({ address: ADDRESS })),
    getNetwork: vi.fn(
      async (): Promise<{
        network: string
        networkPassphrase: string
      }> => {
        throw {
          code: -3,
          message: `${selected.productName} does not support the "getNetwork" function`,
        }
      }
    ),
    signTransaction: vi.fn(async (xdr: string) => ({
      signedTxXdr: xdr,
      signerAddress: ADDRESS,
    })),
    signMessage: vi.fn(async (message: string) => ({
      signedMessage: message,
      signerAddress: ADDRESS,
    })),
    disconnect: vi.fn(async () => {}),
    refreshSupportedWallets: vi.fn(async () =>
      modules.map((m) => ({
        id: m.productId,
        name: m.productName,
        type: 'HOT_WALLET',
        isAvailable: available.includes(m.productId),
        isPlatformWrapper: false,
        icon: '',
        url: '',
      }))
    ),
    on: vi.fn(() => () => {}),
    get selectedModule() {
      return selected
    },
  } satisfies KitFacade
  const bundle: KitBundle = {
    kit,
    modules,
    events: { stateUpdated: 'STATE_UPDATE', disconnect: 'DISCONNECT' },
  }
  return { kit, bundle }
}

function page(overrides: Partial<WalletPage> = {}): WalletPage {
  return {
    isHttps: () => true,
    hasXbullExtension: () => false,
    popupHost: null,
    ...overrides,
  }
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

describe('listing', () => {
  const ids = ['varial', 'xbull', 'rabet', 'hana', 'scopuly', 'albedo']

  test('groups wallets as installed, web and not installed', async () => {
    const fake = fakeKit(ids, ['varial', 'xbull', 'albedo'])
    const wallet = createWalletAdapter({
      loadKit: async () => fake.bundle,
      networkPassphrase: TESTNET,
      page: page(),
    })
    const list = await wallet.listWallets()
    expect(list.map((w) => [w.id, w.access])).toEqual([
      ['varial', 'installed'],
      ['xbull', 'web'],
      ['rabet', 'not-installed'],
      ['hana', 'not-installed'],
      ['scopuly', 'not-installed'],
      ['albedo', 'web'],
    ])
    expect(list[0]).toMatchObject({
      name: 'Varial',
      formerly: 'Freighter',
      url: 'https://varialwallet.com',
      icon: 'https://stellar.creit.tech/wallet-icons/varial.png',
    })
  })

  test('xBull with its extension counts as installed', async () => {
    const fake = fakeKit(ids, ['xbull', 'albedo'])
    const wallet = createWalletAdapter({
      loadKit: async () => fake.bundle,
      networkPassphrase: TESTNET,
      page: page({ hasXbullExtension: () => true }),
    })
    const xbull = (await wallet.listWallets()).find((w) => w.id === 'xbull')
    expect(xbull?.access).toBe('installed')
    await expect(wallet.hasWallet()).resolves.toBe(true)
  })

  test('web wallets alone do not count as an installed wallet', async () => {
    const fake = fakeKit(ids, ['xbull', 'albedo'])
    const wallet = createWalletAdapter({
      loadKit: async () => fake.bundle,
      networkPassphrase: TESTNET,
      page: page(),
    })
    await expect(wallet.hasWallet()).resolves.toBe(false)
  })
})

describe('pop-ups', () => {
  test('a blocked window fails at once and restores window.open', async () => {
    const original = vi.fn(() => null)
    const host = { open: original as (...args: never[]) => unknown }
    const error = await rejection(
      watchPopups(host, 'albedo', () => {
        host.open()
        return new Promise(() => {})
      })
    )
    expect(error.kind).toBe('popup-blocked')
    expect(error.walletId).toBe('albedo')
    expect(host.open).toBe(original)
  })

  test('closing the wallet window ends the request as declined', async () => {
    vi.useFakeTimers()
    const popup = { closed: false }
    const host = { open: vi.fn(() => popup) as (...args: never[]) => unknown }
    const pending = rejection(
      watchPopups(host, 'albedo', () => {
        host.open()
        return new Promise(() => {})
      })
    )
    await vi.advanceTimersByTimeAsync(POPUP_POLL_MS * 4)
    popup.closed = true
    await vi.advanceTimersByTimeAsync(POPUP_POLL_MS + POPUP_CLOSED_GRACE_MS)
    const error = await pending
    expect(error.kind).toBe('rejected')
    expect(walletErrorMessage(error)?.detail).toMatch(
      /^The Albedo window was closed or the request was declined/
    )
  })

  test('a wallet that answers as its window closes is not overridden', async () => {
    vi.useFakeTimers()
    const popup = { closed: false }
    const host = { open: vi.fn(() => popup) as (...args: never[]) => unknown }
    const result = watchPopups(host, 'albedo', async () => {
      host.open()
      await new Promise((resolve) => setTimeout(resolve, POPUP_POLL_MS * 2))
      popup.closed = true
      await new Promise((resolve) => setTimeout(resolve, 100))
      return 'signed'
    })
    await vi.advanceTimersByTimeAsync(POPUP_POLL_MS * 2 + 100)
    await expect(result).resolves.toBe('signed')
  })

  test('an opened window does not interrupt the request', async () => {
    const host = { open: vi.fn(() => ({})) as (...args: never[]) => unknown }
    await expect(
      watchPopups(host, 'xbull', async () => {
        host.open()
        return 'done'
      })
    ).resolves.toBe('done')
  })

  test('connecting xBull’s web wallet with pop-ups blocked', async () => {
    const host = { open: vi.fn(() => null) as (...args: never[]) => unknown }
    const fake = fakeKit(['varial', 'xbull'])
    fake.kit.fetchAddress.mockImplementationOnce(() => {
      host.open()
      return new Promise(() => {})
    })
    const wallet = createWalletAdapter({
      loadKit: async () => fake.bundle,
      networkPassphrase: TESTNET,
      page: page({ popupHost: host }),
    })
    const error = await rejection(wallet.connect({ walletId: 'xbull' }))
    expect(error.kind).toBe('popup-blocked')
  })

  test('extension wallets are not watched', async () => {
    const host = { open: vi.fn(() => null) as (...args: never[]) => unknown }
    const original = host.open
    const fake = fakeKit(['varial'])
    fake.kit.fetchAddress.mockImplementationOnce(async () => {
      expect(host.open).toBe(original)
      return { address: ADDRESS }
    })
    const wallet = createWalletAdapter({
      loadKit: async () => fake.bundle,
      networkPassphrase: TESTNET,
      page: page({ popupHost: host }),
    })
    await expect(wallet.connect({ walletId: 'varial' })).resolves.toMatchObject(
      { walletId: 'varial' }
    )
  })
})

function classic(source = ADDRESS) {
  return new TransactionBuilder(new Account(source, '1'), {
    fee: '100',
    networkPassphrase: TESTNET,
  })
    .addOperation(Operation.manageData({ name: 'qa', value: 'tip' }))
    .setTimeout(300)
    .build()
}

function soroban(source = ADDRESS) {
  return new TransactionBuilder(new Account(source, '1'), {
    fee: '100',
    networkPassphrase: TESTNET,
  })
    .addOperation(
      Operation.invokeContractFunction({
        contract: 'CAFCGOIM6SKVBWCPFQODN22MY5HUJEJMW5AOMNGAOVZ4QBLJJ5RLOOMS',
        function: 'tip',
        args: [],
      })
    )
    .setTimeout(300)
    .build()
}

/** Signs `tx` with `key` for `passphrase` (a wallet on that network). */
function signFor(xdr: string, key: Keypair, passphrase: string) {
  const tx = TransactionBuilder.fromXDR(xdr, passphrase)
  tx.sign(key)
  return tx.toXDR()
}

describe('signature check for wallets that cannot report a network', () => {
  test('checkSourceSignature tells testnet, another network and another key apart', async () => {
    const xdr = classic().toXDR()
    await expect(
      checkSourceSignature(signFor(xdr, KEY, TESTNET), ADDRESS, TESTNET)
    ).resolves.toBe('ok')
    await expect(
      checkSourceSignature(signFor(xdr, KEY, Networks.PUBLIC), ADDRESS, TESTNET)
    ).resolves.toBe('wrong-network')
    await expect(
      checkSourceSignature(
        signFor(xdr, Keypair.random(), TESTNET),
        ADDRESS,
        TESTNET
      )
    ).resolves.toBe('wrong-account')
  })

  function adapter(walletId: string, sign: (xdr: string) => string) {
    const fake = fakeKit([walletId])
    fake.kit.signTransaction.mockImplementation(async (xdr: string) => ({
      signedTxXdr: sign(xdr),
      signerAddress: ADDRESS,
    }))
    const wallet = createWalletAdapter({
      loadKit: async () => fake.bundle,
      networkPassphrase: TESTNET,
      page: page(),
      verifySignature: checkSourceSignature,
      describeEnvelope: (xdr) => describeEnvelope(xdr, TESTNET),
    })
    return { wallet, fake }
  }

  test.each(['xbull', 'rabet', 'hana', 'albedo'])(
    '%s on testnet: the signature is accepted',
    async (walletId) => {
      const { wallet } = adapter(walletId, (xdr) => signFor(xdr, KEY, TESTNET))
      await wallet.connect({ walletId })
      expect(wallet.getConnection()?.networkReported).toBe(false)
      const xdr = soroban().toXDR()
      await expect(wallet.signTransaction(xdr)).resolves.toMatchObject({
        signerAddress: ADDRESS,
      })
    }
  )

  test.each(['xbull', 'rabet', 'hana', 'albedo'])(
    '%s on mainnet: the signature is refused as the wrong network, nothing sent',
    async (walletId) => {
      const { wallet } = adapter(walletId, (xdr) =>
        signFor(xdr, KEY, Networks.PUBLIC)
      )
      await wallet.connect({ walletId })
      const error = await rejection(wallet.signTransaction(soroban().toXDR()))
      expect(error.kind).toBe('wrong-network')
      expect(walletErrorMessage(error)).toEqual({
        title: 'Switch your wallet to Testnet',
        detail: expect.stringMatching(
          /QuillTip uses Testnet\. Change the network in .+, then try again\. Nothing was sent\.$/
        ),
      })
    }
  )

  test('a wallet that reports its network is not re-checked', async () => {
    const fake = fakeKit(['varial'])
    fake.kit.getNetwork.mockResolvedValue({
      network: 'TESTNET',
      networkPassphrase: TESTNET,
    })
    const verifySignature = vi.fn(checkSourceSignature)
    const wallet = createWalletAdapter({
      loadKit: async () => fake.bundle,
      networkPassphrase: TESTNET,
      page: page(),
      verifySignature,
    })
    await wallet.connect({ walletId: 'varial' })
    await wallet.signTransaction(classic().toXDR())
    expect(verifySignature).not.toHaveBeenCalled()
  })

  test('an unreadable envelope fails without being sent', async () => {
    const { wallet } = adapter('xbull', () => 'not-xdr')
    await wallet.connect({ walletId: 'xbull' })
    expect(
      (await rejection(wallet.signTransaction(classic().toXDR()))).kind
    ).toBe('failed')
  })
})

describe('capability gate', () => {
  test('describeEnvelope finds Soroban calls', async () => {
    await expect(describeEnvelope(soroban().toXDR(), TESTNET)).resolves.toEqual(
      { soroban: true }
    )
    await expect(describeEnvelope(classic().toXDR(), TESTNET)).resolves.toEqual(
      { soroban: false }
    )
  })

  test('a wallet that cannot sign Soroban calls is refused before it is prompted', async () => {
    const fake = fakeKit(['TREZOR'])
    const wallet = createWalletAdapter({
      loadKit: async () => fake.bundle,
      networkPassphrase: TESTNET,
      page: page(),
      describeEnvelope: (xdr) => describeEnvelope(xdr, TESTNET),
    })
    await wallet.connect({ walletId: 'TREZOR' })
    const error = await rejection(wallet.signTransaction(soroban().toXDR()))
    expect(error.kind).toBe('unsupported')
    expect(walletErrorMessage(error)).toEqual({
      title: 'This wallet cannot be used here',
      detail:
        'Trezor cannot sign Soroban contract calls, which this payment uses. Connect another wallet, such as Varial or xBull.',
    })
    expect(fake.kit.signTransaction).not.toHaveBeenCalled()
  })

  test('wallets without message signing still prove the address with a transaction', async () => {
    for (const entry of OFFERED_WALLETS) {
      if (!entry.capabilities.message) {
        // wallet-ownership.ts falls back to the challenge transaction on
        // `unsupported`; the transaction path is covered there.
        expect(entry.capabilities.transaction).toBe(true)
      }
    }
    expect(
      OFFERED_WALLETS.filter((w) => !w.capabilities.message).map((w) => w.id)
    ).toEqual(['rabet', 'albedo'])
  })
})
