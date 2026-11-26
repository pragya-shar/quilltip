/**
 * QuillTip's WalletConnect module (#511) against a fake sign client: pairing,
 * session restore and expiry, wrong chain, missing methods, refusals,
 * timeouts and disconnects from either side, and how each maps to the app's
 * wallet states.
 */
import { afterEach, describe, expect, test, vi } from 'vitest'
import {
  Account,
  Keypair,
  Networks,
  Operation,
  TransactionBuilder,
} from '@stellar/stellar-sdk'
import {
  WalletConnectModule,
  type WcSession,
  type WcSignClient,
} from '../../lib/stellar/v2/walletconnect-module'
import {
  classifyWalletError,
  walletErrorMessage,
  type WalletErrorKind,
} from '../../lib/stellar/v2/wallet-errors'
import {
  createWalletAdapter,
  type KitBundle,
  type KitFacade,
} from '../../lib/stellar/v2/wallet'
import { checkSourceSignature } from '../../lib/stellar/v2/wallet-signature'
import {
  walletConnectProjectId,
  WALLETCONNECT_INVALID_MESSAGE,
} from '../../lib/stellar/v2/walletconnect-gate'

const KEY = Keypair.random()
const ADDRESS = KEY.publicKey()
const NOW = 1_800_000_000_000
const TOPIC = 'topic-1'

function session(overrides: Partial<WcSession> = {}): WcSession {
  return {
    topic: TOPIC,
    expiry: NOW / 1000 + 7 * 24 * 3600,
    namespaces: {
      stellar: {
        accounts: [`stellar:testnet:${ADDRESS}`],
        methods: ['stellar_signXDR', 'stellar_signMessage'],
        events: [],
      },
    },
    peer: { metadata: { name: 'Varial' } },
    ...overrides,
  }
}

/** A fake sign client; `approve` settles the pending pairing. */
function fakeClient(sessions: WcSession[] = []) {
  const listeners = new Map<string, (event: { topic: string }) => void>()
  let settle: {
    resolve: (s: WcSession) => void
    reject: (e: unknown) => void
  } | null = null
  const client = {
    connect: vi.fn(async () => ({
      uri: 'wc:abc@2?relay-protocol=irn&symKey=def',
      approval: () =>
        new Promise<WcSession>((resolve, reject) => {
          settle = { resolve, reject }
        }),
    })),
    request: vi.fn(
      async (params: {
        request: { method: string; params: unknown }
      }): Promise<{
        signedXDR?: string
        signature?: string
        signerAddress?: string
      }> =>
        params.request.method === 'stellar_signXDR'
          ? { signedXDR: 'SIGNED' }
          : { signature: 'SIG', signerAddress: ADDRESS }
    ),
    disconnect: vi.fn(async () => {}),
    session: { getAll: () => sessions },
    on: vi.fn((event: string, listener: (e: { topic: string }) => void) => {
      listeners.set(event, listener)
    }),
  }
  return {
    client: client as unknown as WcSignClient & typeof client,
    approve: (s: WcSession) => settle?.resolve(s),
    refuse: (e: unknown) => settle?.reject(e),
    fire: (event: string, topic = TOPIC) => listeners.get(event)?.({ topic }),
  }
}

function moduleFor(fake: ReturnType<typeof fakeClient>) {
  const pairing = { show: vi.fn(), clear: vi.fn() }
  const onSessionEnded = vi.fn()
  const loadSignClient = vi.fn(async () => fake.client)
  const module = new WalletConnectModule({
    projectId: '0123456789abcdef0123456789abcdef',
    metadata: {
      name: 'QuillTip',
      description: 'd',
      url: 'https://example.test',
      icons: [],
    },
    loadSignClient,
    pairing,
    onSessionEnded,
    now: () => NOW,
  })
  return { module, pairing, onSessionEnded, loadSignClient }
}

async function pair(fake: ReturnType<typeof fakeClient>, s = session()) {
  const parts = moduleFor(fake)
  const address = parts.module.getAddress()
  await vi.waitFor(() => expect(parts.pairing.show).toHaveBeenCalled())
  fake.approve(s)
  return { ...parts, address: await address }
}

async function caught(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise
  } catch (error) {
    return error
  }
  throw new Error('Expected a rejection')
}

afterEach(() => {
  vi.useRealTimers()
})

describe('project ID gate', () => {
  test('blank is off, a project ID is on, anything else is refused', () => {
    expect(walletConnectProjectId(undefined)).toBeNull()
    expect(walletConnectProjectId('  ')).toBeNull()
    expect(walletConnectProjectId(' 0123456789abcdef0123456789abcdef ')).toBe(
      '0123456789abcdef0123456789abcdef'
    )
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
    for (const bad of [
      'qa-project-id',
      '0123456789ABCDEF0123456789ABCDEF',
      '0123456789abcdef0123456789abcde',
      'wc:0123456789abcdef0123456789abcdef',
    ]) {
      expect(() => walletConnectProjectId(bad)).toThrow(
        WALLETCONNECT_INVALID_MESSAGE
      )
    }
    errors.mockRestore()
  })
})

describe('pairing', () => {
  test('asks for Stellar testnet only, shows the pairing, then clears it', async () => {
    const fake = fakeClient()
    const { address, pairing, loadSignClient } = await pair(fake)
    expect(address).toEqual({ address: ADDRESS })
    expect(loadSignClient).toHaveBeenCalledTimes(1)
    expect(fake.client.connect).toHaveBeenCalledWith({
      requiredNamespaces: {
        stellar: {
          methods: ['stellar_signXDR'],
          chains: ['stellar:testnet'],
          events: [],
        },
      },
      optionalNamespaces: {
        stellar: {
          methods: ['stellar_signMessage'],
          chains: ['stellar:testnet'],
          events: [],
        },
      },
    })
    expect(pairing.show).toHaveBeenCalledWith({
      uri: 'wc:abc@2?relay-protocol=irn&symKey=def',
      expiresAt: NOW + 5 * 60_000,
    })
    expect(pairing.clear).toHaveBeenCalled()
  })

  test('no relay connection until a reader chooses it', () => {
    const { loadSignClient } = moduleFor(fakeClient())
    expect(loadSignClient).not.toHaveBeenCalled()
  })

  test('restores a live testnet session without a new pairing', async () => {
    const fake = fakeClient([session()])
    const { module, pairing } = moduleFor(fake)
    await expect(module.getAddress()).resolves.toEqual({ address: ADDRESS })
    expect(fake.client.connect).not.toHaveBeenCalled()
    expect(pairing.show).not.toHaveBeenCalled()
  })

  test('does not reuse a session that is about to expire', async () => {
    const fake = fakeClient([session({ expiry: NOW / 1000 + 30 })])
    const { module } = moduleFor(fake)
    void module.getAddress()
    await vi.waitFor(() => expect(fake.client.connect).toHaveBeenCalled())
  })
})

const kind = (error: unknown): WalletErrorKind =>
  classifyWalletError(error, 'wallet_connect').kind

describe('states', () => {
  test('the wallet declines the pairing: rejected, pairing cleared', async () => {
    const fake = fakeClient()
    const { module, pairing } = moduleFor(fake)
    const result = caught(module.getAddress())
    await vi.waitFor(() => expect(pairing.show).toHaveBeenCalled())
    fake.refuse({ code: 5000, message: 'User rejected.' })
    expect(kind(await result)).toBe('rejected')
    expect(pairing.clear).toHaveBeenCalled()
  })

  test('the pairing expires: timeout', async () => {
    const fake = fakeClient()
    const { module, pairing } = moduleFor(fake)
    const result = caught(module.getAddress())
    await vi.waitFor(() => expect(pairing.show).toHaveBeenCalled())
    fake.refuse(new Error('Proposal expired'))
    expect(kind(await result)).toBe('timeout')
  })

  test('a wallet that pairs on mainnet only: wrong network, session closed', async () => {
    const fake = fakeClient()
    const { module, pairing } = moduleFor(fake)
    const result = caught(module.getAddress())
    await vi.waitFor(() => expect(pairing.show).toHaveBeenCalled())
    fake.approve(
      session({
        namespaces: {
          stellar: {
            accounts: [`stellar:pubnet:${ADDRESS}`],
            methods: ['stellar_signXDR'],
            events: [],
          },
        },
      })
    )
    const error = await result
    expect(kind(error)).toBe('wrong-network')
    expect(fake.client.disconnect).toHaveBeenCalledWith({
      topic: TOPIC,
      reason: { code: 6000, message: 'User disconnected.' },
    })
  })

  test('a wallet without transaction signing: unsupported', async () => {
    const fake = fakeClient()
    const { module, pairing } = moduleFor(fake)
    const result = caught(module.getAddress())
    await vi.waitFor(() => expect(pairing.show).toHaveBeenCalled())
    fake.approve(
      session({
        namespaces: {
          stellar: {
            accounts: [`stellar:testnet:${ADDRESS}`],
            methods: ['stellar_signMessage'],
            events: [],
          },
        },
      })
    )
    expect(kind(await result)).toBe('unsupported')
  })

  test('signs on testnet with the session', async () => {
    const fake = fakeClient()
    const { module } = await pair(fake)
    await expect(module.signTransaction('AAAA')).resolves.toEqual({
      signedTxXdr: 'SIGNED',
      signerAddress: ADDRESS,
    })
    expect(fake.client.request).toHaveBeenCalledWith({
      topic: TOPIC,
      chainId: 'stellar:testnet',
      request: { method: 'stellar_signXDR', params: { xdr: 'AAAA' } },
    })
  })

  test.each([
    [{ code: 5000, message: 'User rejected the request' }, 'rejected'],
    [{ code: 4001, message: 'User rejected' }, 'rejected'],
    [new Error('Request expired. Please try again.'), 'timeout'],
    [{ code: 5100, message: 'Unsupported chains' }, 'wrong-network'],
    [
      { code: 5000, message: 'Please switch to Testnet in Varial Settings' },
      'wrong-network',
    ],
    [
      { message: 'Please switch to Testnet in Varial Settings' },
      'wrong-network',
    ],
    [{ code: 5101, message: 'Unsupported methods' }, 'unsupported'],
    [
      new Error("No matching key. session topic doesn't exist: topic-1"),
      'disconnected',
    ],
  ] as const)('a signing failure %o is %s', async (thrown, expected) => {
    const fake = fakeClient()
    const { module } = await pair(fake)
    fake.client.request.mockRejectedValueOnce(thrown)
    expect(kind(await caught(module.signTransaction('AAAA')))).toBe(expected)
  })

  test('message signing is optional: without it the module says unsupported', async () => {
    const fake = fakeClient()
    const { module } = await pair(
      fake,
      session({
        namespaces: {
          stellar: {
            accounts: [`stellar:testnet:${ADDRESS}`],
            methods: ['stellar_signXDR'],
            events: [],
          },
        },
      })
    )
    expect(kind(await caught(module.signMessage('hello')))).toBe('unsupported')
    expect(fake.client.request).not.toHaveBeenCalled()
  })

  test('the phone ends the session: the app is told, signing then fails as disconnected', async () => {
    const fake = fakeClient()
    const { module, onSessionEnded } = await pair(fake)
    fake.fire('session_delete')
    expect(onSessionEnded).toHaveBeenCalledTimes(1)
    const error = await caught(module.signTransaction('AAAA'))
    expect(kind(error)).toBe('disconnected')
    expect(
      walletErrorMessage(classifyWalletError(error, 'wallet_connect'))
    ).toEqual({
      title: 'Your wallet disconnected',
      detail:
        'Mobile wallet ended the connection. Connect again, then try again. Nothing was sent.',
    })
  })

  test('the session expires on the relay: the same as an end from the phone', async () => {
    const fake = fakeClient()
    const { module, onSessionEnded } = await pair(fake)
    fake.fire('session_expire')
    expect(onSessionEnded).toHaveBeenCalled()
    expect(kind(await caught(module.signTransaction('AAAA')))).toBe(
      'disconnected'
    )
  })

  test('another session ending is ignored', async () => {
    const fake = fakeClient()
    const { onSessionEnded } = await pair(fake)
    fake.fire('session_delete', 'other-topic')
    expect(onSessionEnded).not.toHaveBeenCalled()
  })

  test('disconnecting here ends the session on the phone', async () => {
    const fake = fakeClient()
    const { module } = await pair(fake)
    await module.disconnect()
    expect(fake.client.disconnect).toHaveBeenCalledWith({
      topic: TOPIC,
      reason: { code: 6000, message: 'User disconnected.' },
    })
  })

  test('the network cannot be read from the wallet', async () => {
    const fake = fakeClient()
    const { module } = await pair(fake)
    expect(kind(await caught(module.getNetwork()))).toBe('unsupported')
  })
})

describe('through the adapter', () => {
  function kitWith(module: WalletConnectModule) {
    const kit = {
      init: vi.fn(),
      setWallet: vi.fn(),
      authModal: vi.fn(),
      fetchAddress: () => module.getAddress(),
      getNetwork: () => module.getNetwork(),
      signTransaction: (xdr: string) => module.signTransaction(xdr),
      signMessage: (message: string) => module.signMessage(message),
      disconnect: () => module.disconnect(),
      refreshSupportedWallets: async () => [
        {
          id: 'wallet_connect',
          name: 'Mobile wallet',
          type: 'BRIDGE_WALLET',
          isAvailable: true,
          isPlatformWrapper: false,
          icon: '',
          url: '',
        },
      ],
      on: vi.fn(() => () => {}),
      selectedModule: {
        productId: 'wallet_connect',
        productName: 'Mobile wallet',
      },
    }
    const bundle: KitBundle = {
      kit: kit as unknown as KitFacade,
      modules: [module],
      events: { stateUpdated: 'STATE_UPDATE', disconnect: 'DISCONNECT' },
    }
    return createWalletAdapter({
      loadKit: async () => bundle,
      networkPassphrase: Networks.TESTNET,
      page: { isHttps: () => true, hasXbullExtension: () => false },
      verifySignature: checkSourceSignature,
    })
  }

  function tx() {
    return new TransactionBuilder(new Account(ADDRESS, '1'), {
      fee: '100',
      networkPassphrase: Networks.TESTNET,
    })
      .addOperation(Operation.manageData({ name: 'qa', value: 'tip' }))
      .setTimeout(300)
      .build()
  }

  test('listed as a mobile wallet; pairing waits beyond the default 60 s', async () => {
    vi.useFakeTimers()
    const fake = fakeClient()
    const { module, pairing } = moduleFor(fake)
    const wallet = kitWith(module)
    expect((await wallet.listWallets())[0]).toMatchObject({
      id: 'wallet_connect',
      access: 'mobile',
      isAvailable: true,
    })
    const connecting = wallet.connect({ walletId: 'wallet_connect' })
    await vi.waitFor(() => expect(pairing.show).toHaveBeenCalled())
    await vi.advanceTimersByTimeAsync(4 * 60_000)
    fake.approve(session())
    await expect(connecting).resolves.toMatchObject({
      walletId: 'wallet_connect',
      address: ADDRESS,
      networkReported: false,
    })
  })

  test('a phone that signs for mainnet is refused after signing', async () => {
    const fake = fakeClient()
    const { module, pairing } = moduleFor(fake)
    const wallet = kitWith(module)
    const connecting = wallet.connect({ walletId: 'wallet_connect' })
    await vi.waitFor(() => expect(pairing.show).toHaveBeenCalled())
    fake.approve(session())
    await connecting
    fake.client.request.mockImplementationOnce(
      async (params: { request: { params: unknown } }) => {
        const { xdr } = params.request.params as { xdr: string }
        const signed = TransactionBuilder.fromXDR(xdr, Networks.PUBLIC)
        signed.sign(KEY)
        return { signedXDR: signed.toXDR() }
      }
    )
    const error = await caught(wallet.signTransaction(tx().toXDR()))
    expect((error as { kind: string }).kind).toBe('wrong-network')
  })
})
