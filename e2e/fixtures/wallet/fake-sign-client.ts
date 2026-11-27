/**
 * A test-only stand-in for `@walletconnect/sign-client`, for the wallet
 * fixture's WalletConnect build (`?wc=1`). It plays both the relay and the
 * phone: the spec drives it through `window.__wcFake`. It signs with the
 * fixture's throwaway testnet key (`window.__fixtureWallet`). Nothing is sent
 * to a network.
 */
type Session = {
  topic: string
  expiry: number
  namespaces: Record<
    string,
    { accounts: string[]; methods: string[]; events: string[] }
  >
  peer: { metadata: { name: string } }
}
type Settle = { resolve: (s: Session) => void; reject: (e: unknown) => void }
type FixtureWallet = {
  address: string
  signMessage(message: string): string
  signTransactionFor(xdr: string, passphrase: string): string
}

/** How the "phone" answers signing requests. */
type SignMode = 'approve' | 'reject' | 'mainnet' | 'switch' | 'silent'

const TESTNET = 'Test SDF Network ; September 2015'
const PUBLIC = 'Public Global Stellar Network ; September 2015'

// Sessions survive a reload, as the real client keeps them in IndexedDB.
const STORE = 'qa-wc-sessions'
const stored = (): Session[] => {
  try {
    return JSON.parse(sessionStorage.getItem(STORE) ?? '[]')
  } catch {
    return []
  }
}
const save = () => sessionStorage.setItem(STORE, JSON.stringify(state.sessions))

const state = {
  inits: 0,
  pairings: 0,
  uri: null as string | null,
  pending: null as Settle | null,
  sessions: stored(),
  requests: [] as { method: string; chainId: string }[],
  disconnects: [] as string[],
  signMode: 'approve' as SignMode,
  listeners: new Map<string, (event: { topic: string }) => void>(),
}

const key = () =>
  (window as unknown as { __fixtureWallet: FixtureWallet }).__fixtureWallet

function newSession(opts: { chain?: string; methods?: string[] }): Session {
  return {
    topic: `topic-${crypto.randomUUID()}`,
    expiry: Math.floor(Date.now() / 1000) + 7 * 24 * 3600,
    namespaces: {
      stellar: {
        accounts: [`${opts.chain ?? 'stellar:testnet'}:${key().address}`],
        methods: opts.methods ?? ['stellar_signXDR', 'stellar_signMessage'],
        events: [],
      },
    },
    peer: { metadata: { name: 'Test phone wallet' } },
  }
}

/** Controls for the spec. */
const controls = {
  state,
  /** The phone scans the code and approves. */
  approve(opts: { chain?: string; methods?: string[] } = {}) {
    const session = newSession(opts)
    state.sessions.push(session)
    save()
    state.pending?.resolve(session)
    state.pending = null
  },
  /** The phone declines the pairing. */
  decline() {
    state.pending?.reject({ code: 5000, message: 'User rejected.' })
    state.pending = null
  },
  /** The pairing proposal expires. */
  expire() {
    state.pending?.reject(new Error('Proposal expired'))
    state.pending = null
  },
  /** The phone ends the session. */
  endSession() {
    const session = state.sessions.pop()
    save()
    if (session)
      state.listeners.get('session_delete')?.({ topic: session.topic })
  },
  setSignMode(mode: SignMode) {
    state.signMode = mode
  },
}
;(window as unknown as { __wcFake: typeof controls }).__wcFake = controls

const client = {
  async connect() {
    state.pairings += 1
    state.uri = `wc:fixture${state.pairings}@2?relay-protocol=irn&symKey=${'ab'.repeat(32)}`
    return {
      uri: state.uri,
      approval: () =>
        new Promise<Session>((resolve, reject) => {
          state.pending = { resolve, reject }
        }),
    }
  },
  async request(params: {
    topic: string
    chainId: string
    request: { method: string; params: { xdr?: string; message?: string } }
  }) {
    state.requests.push({
      method: params.request.method,
      chainId: params.chainId,
    })
    if (!state.sessions.some((s) => s.topic === params.topic)) {
      throw new Error(
        `No matching key. session topic doesn't exist: ${params.topic}`
      )
    }
    switch (state.signMode) {
      case 'silent':
        return new Promise(() => {})
      case 'reject':
        throw { code: 5000, message: 'User rejected the request' }
      case 'switch':
        throw {
          code: 5000,
          message: 'Please switch to Testnet in Varial Settings',
        }
    }
    if (params.request.method === 'stellar_signMessage') {
      return {
        signature: key().signMessage(params.request.params.message ?? ''),
        signerAddress: key().address,
      }
    }
    return {
      signedXDR: key().signTransactionFor(
        params.request.params.xdr ?? '',
        state.signMode === 'mainnet' ? PUBLIC : TESTNET
      ),
    }
  },
  async disconnect(params: { topic: string }) {
    state.disconnects.push(params.topic)
    state.sessions = state.sessions.filter((s) => s.topic !== params.topic)
    save()
  },
  session: { getAll: () => state.sessions },
  on(event: string, listener: (event: { topic: string }) => void) {
    state.listeners.set(event, listener)
  },
}

export const SignClient = {
  async init() {
    state.inits += 1
    return client
  },
}
