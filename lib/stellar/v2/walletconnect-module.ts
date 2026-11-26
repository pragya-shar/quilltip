/**
 * QuillTip's WalletConnect module for Stellar Wallets Kit 2.x: mobile wallets
 * (Varial, LOBSTR, Scopuly and others) pair by QR code or deep link and sign
 * on the phone.
 *
 * It talks to `@walletconnect/sign-client` directly instead of using the
 * kit's WalletConnect module, which also starts Reown AppKit. AppKit's only
 * zod code (its embedded email and social login) runs on the app's zod 4
 * override with one known difference, and the module opens a relay
 * connection as soon as it is constructed. This module never loads AppKit,
 * connects to the relay only when a reader chooses it, and shows QuillTip's
 * own pairing step (`walletconnect-pairing.ts`). See docs/wallets.md.
 *
 * Rules:
 * - Sessions must include `stellar:testnet`; a wallet that pairs on another
 *   chain is refused (`wrong-network`) and the session closed.
 * - Every request names `stellar:testnet`. The wallet cannot report its
 *   network, so the adapter checks the returned signature (`wallet.ts`).
 * - Message signing is optional: without `stellar_signMessage` the module
 *   says it is unsupported and the address proof signs a transaction.
 * - A session ended on the phone, or expired, ends the connection here
 *   (`onSessionEnded`); a live session is reused instead of a new QR code.
 *
 * Errors keep the kit's `{ code, message }` shape; `wallet-errors.ts` maps
 * them (`WALLET_ERROR_RULES.wallet_connect`).
 */
import type {
  ModuleInterface,
  ModuleType,
} from '@creit.tech/stellar-wallets-kit/types'
import type { Pairing } from './walletconnect-pairing'

export const WALLETCONNECT_ID = 'wallet_connect'
export const STELLAR_TESTNET_CHAIN = 'stellar:testnet'

export const WALLETCONNECT_METHODS = {
  signXdr: 'stellar_signXDR',
  signMessage: 'stellar_signMessage',
} as const

/** A session must have more than this left to be reused, in seconds. */
const MIN_SESSION_LEFT_S = 60
/** WalletConnect's default proposal expiry, five minutes. */
const PROPOSAL_TTL_MS = 5 * 60_000

type Namespace = {
  accounts: string[]
  methods: string[]
  events: string[]
  chains?: string[]
}

export type WcSession = {
  topic: string
  /** Epoch seconds. */
  expiry: number
  namespaces: Record<string, Namespace>
  peer: { metadata: { name: string; url?: string; icons?: string[] } }
}

/** The part of `SignClient` the module uses, so tests can pass a fake. */
export type WcSignClient = {
  connect(params: {
    requiredNamespaces?: Record<string, Omit<Namespace, 'accounts'>>
    optionalNamespaces?: Record<string, Omit<Namespace, 'accounts'>>
  }): Promise<{ uri?: string; approval: () => Promise<WcSession> }>
  request<T>(params: {
    topic: string
    chainId: string
    request: { method: string; params: unknown }
  }): Promise<T>
  disconnect(params: {
    topic: string
    reason: { code: number; message: string }
  }): Promise<void>
  session: { getAll(): WcSession[] }
  on(
    event: 'session_delete' | 'session_expire',
    listener: (event: { topic: string }) => void
  ): unknown
}

export type WcMetadata = {
  name: string
  description: string
  url: string
  icons: string[]
}

export type WalletConnectModuleOptions = {
  projectId: string
  metadata: WcMetadata
  /** Creates the sign client; called once, when a reader first uses it. */
  loadSignClient: (options: {
    projectId: string
    metadata: WcMetadata
  }) => Promise<WcSignClient>
  /** Shows and clears the pairing step. */
  pairing: { show(pairing: Pairing): void; clear(): void }
  /** The wallet ended the session (deleted on the phone, or expired). */
  onSessionEnded?: () => void
  now?: () => number
}

const fail = (code: number, message: string) => ({ code, message })

function testnetAccount(session: WcSession): string | null {
  const account = (session.namespaces.stellar?.accounts ?? []).find((value) =>
    value.startsWith(`${STELLAR_TESTNET_CHAIN}:`)
  )
  return account ? account.slice(STELLAR_TESTNET_CHAIN.length + 1) : null
}

function supports(session: WcSession, method: string) {
  return session.namespaces.stellar?.methods.includes(method) ?? false
}

export class WalletConnectModule implements ModuleInterface {
  readonly moduleType = 'BRIDGE_WALLET' as ModuleType
  readonly productId = WALLETCONNECT_ID
  readonly productName = 'Mobile wallet'
  readonly productUrl = 'https://walletconnect.network'
  readonly productIcon =
    'https://stellar.creit.tech/wallet-icons/walletconnect.png'

  private client: Promise<WcSignClient> | null = null
  private session: WcSession | null = null
  private readonly now: () => number

  constructor(private readonly options: WalletConnectModuleOptions) {
    this.now = options.now ?? Date.now
  }

  /** Configured: a reader can always pair a phone. */
  async isAvailable(): Promise<boolean> {
    return true
  }

  private signClient(): Promise<WcSignClient> {
    this.client ??= this.options
      .loadSignClient({
        projectId: this.options.projectId,
        metadata: this.options.metadata,
      })
      .then((client) => {
        const ended = ({ topic }: { topic: string }) => {
          if (this.session?.topic !== topic) return
          this.session = null
          this.options.onSessionEnded?.()
        }
        client.on('session_delete', ended)
        client.on('session_expire', ended)
        return client
      })
      .catch((error) => {
        this.client = null
        throw error
      })
    return this.client
  }

  /** A live testnet session from an earlier pairing, if one is left. */
  private restorable(client: WcSignClient): WcSession | null {
    const cutoff = this.now() / 1000 + MIN_SESSION_LEFT_S
    return (
      client.session
        .getAll()
        .filter((s) => s.expiry > cutoff && testnetAccount(s))
        .sort((a, b) => b.expiry - a.expiry)[0] ?? null
    )
  }

  async getAddress(): Promise<{ address: string }> {
    const client = await this.signClient()
    let session = this.restorable(client)
    if (!session) {
      const { uri, approval } = await client.connect({
        requiredNamespaces: {
          stellar: {
            methods: [WALLETCONNECT_METHODS.signXdr],
            chains: [STELLAR_TESTNET_CHAIN],
            events: [],
          },
        },
        optionalNamespaces: {
          stellar: {
            methods: [WALLETCONNECT_METHODS.signMessage],
            chains: [STELLAR_TESTNET_CHAIN],
            events: [],
          },
        },
      })
      if (uri) {
        this.options.pairing.show({
          uri,
          expiresAt: this.now() + PROPOSAL_TTL_MS,
        })
      }
      try {
        session = await approval()
      } finally {
        this.options.pairing.clear()
      }
    }
    const address = testnetAccount(session)
    if (!address) {
      await this.close(client, session.topic)
      throw fail(
        -3,
        'The WalletConnect wallet is not on Stellar testnet. Switch it to testnet, then connect again.'
      )
    }
    if (!supports(session, WALLETCONNECT_METHODS.signXdr)) {
      await this.close(client, session.topic)
      throw fail(
        -3,
        'This WalletConnect wallet does not support the "signTransaction" function'
      )
    }
    this.session = session
    return { address }
  }

  private async live(): Promise<{ client: WcSignClient; session: WcSession }> {
    const client = await this.signClient()
    const session = this.session
    if (!session || session.expiry <= this.now() / 1000) {
      this.session = null
      throw fail(-1, 'The WalletConnect session ended')
    }
    return { client, session }
  }

  async signTransaction(
    xdr: string
  ): Promise<{ signedTxXdr: string; signerAddress?: string }> {
    const { client, session } = await this.live()
    const result = await client.request<{ signedXDR?: string }>({
      topic: session.topic,
      chainId: STELLAR_TESTNET_CHAIN,
      request: { method: WALLETCONNECT_METHODS.signXdr, params: { xdr } },
    })
    if (!result?.signedXDR) {
      throw fail(-1, 'The wallet returned no signature')
    }
    return {
      signedTxXdr: result.signedXDR,
      signerAddress: testnetAccount(session) ?? undefined,
    }
  }

  async signMessage(
    message: string
  ): Promise<{ signedMessage: string; signerAddress?: string }> {
    const { client, session } = await this.live()
    if (!supports(session, WALLETCONNECT_METHODS.signMessage)) {
      throw fail(
        -3,
        'This WalletConnect wallet does not support the "signMessage" function'
      )
    }
    const result = await client.request<{
      signature?: string
      signerAddress?: string
    }>({
      topic: session.topic,
      chainId: STELLAR_TESTNET_CHAIN,
      request: {
        method: WALLETCONNECT_METHODS.signMessage,
        params: { message },
      },
    })
    if (!result?.signature) {
      throw fail(-1, 'The wallet returned no signature')
    }
    return {
      signedMessage: result.signature,
      signerAddress:
        result.signerAddress ?? testnetAccount(session) ?? undefined,
    }
  }

  async signAuthEntry(): Promise<never> {
    throw fail(
      -3,
      'This WalletConnect wallet does not support the "signAuthEntry" function'
    )
  }

  /** A wallet over WalletConnect cannot report its network to the page. */
  async getNetwork(): Promise<never> {
    throw fail(-3, 'WalletConnect does not support the "getNetwork" function')
  }

  /** Ends the session on both sides. */
  async disconnect(): Promise<void> {
    const session = this.session
    this.session = null
    this.options.pairing.clear()
    if (!session || !this.client) return
    await this.close(await this.client, session.topic)
  }

  private async close(client: WcSignClient, topic: string) {
    try {
      await client.disconnect({
        topic,
        reason: { code: 6000, message: 'User disconnected.' },
      })
    } catch {
      // The session is gone on the relay already.
    }
  }
}
