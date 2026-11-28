/**
 * Payments v2 chain configuration (docs/architecture/v2/06-app-integration.md,
 * section 6.3).
 *
 * `getChainConfig` is public: network, contract IDs, minimum tip and pause
 * state. `refreshChainConfig` reads the contract views through RPC simulation
 * and caches them in `chainConfig` (hourly cron).
 */
import { ConvexError, v } from 'convex/values'
import {
  Account,
  Address,
  Contract,
  TransactionBuilder,
  nativeToScVal,
  scValToNative,
  xdr,
} from '@stellar/stellar-sdk'
import { internal } from '../_generated/api'
import {
  evaluateTabReadiness,
  readinessLogCode,
} from '../lib/chain/tabReadiness'
import { internalAction, internalMutation, query } from '../_generated/server'
import { readChainEnv, type ChainEnv } from '../lib/chain/env'
import { createBackendRpcClient, type RpcClient } from '../lib/chain/rpc'
import { bytesToHex } from '../lib/chain/ids'
import { acceptorPublicKeyHex, loadAcceptor } from '../lib/chain/voucher'
import { assertBackendTestnet } from '../lib/networkGuard'

/** Any valid account works as the source of a view simulation. */
const VIEW_SOURCE = 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF'

export const getChainConfig = query({
  args: {},
  handler: async (ctx) => {
    const chain = readChainEnv()
    const cached = await ctx.db
      .query('chainConfig')
      .withIndex('by_network', (q) => q.eq('network', chain.network))
      .first()
    return {
      network: chain.network,
      chainEpoch: chain.chainEpoch,
      v2Enabled: chain.v2Enabled,
      coreContractId: chain.coreContractId,
      tabContractId: chain.tabContractId,
      nftContractId: chain.nftContractId,
      tokenContractId: chain.tokenContractId,
      // Cached values are used only when they describe the configured set.
      minTip:
        cached && cached.coreContractId === chain.coreContractId
          ? (cached.minTip ?? null)
          : null,
      feeBps: cached?.feeBps ?? null,
      nftThreshold: cached?.nftThreshold ?? null,
      paused: cached?.paused ?? {},
      refreshedAt: cached?.refreshedAt ?? null,
      // Keys and settlement ready (`tabReadiness.ts`). One boolean: which
      // check failed is for operators only (`chain/tabReadiness`).
      tabReady: evaluateTabReadiness(process.env, cached).ready,
    }
  },
})

export const storeChainConfig = internalMutation({
  args: {
    network: v.union(v.literal('TESTNET'), v.literal('MAINNET')),
    chainEpoch: v.string(),
    coreContractId: v.optional(v.string()),
    tabContractId: v.optional(v.string()),
    nftContractId: v.optional(v.string()),
    tokenContractId: v.optional(v.string()),
    minTip: v.optional(v.string()),
    feeBps: v.optional(v.number()),
    nftThreshold: v.optional(v.string()),
    nftThresholdToken: v.optional(v.string()),
    tabAcceptorKeys: v.optional(v.array(v.string())),
    tabSettlers: v.optional(v.array(v.string())),
    paused: v.object({
      core: v.optional(v.boolean()),
      tab: v.optional(v.boolean()),
      nft: v.optional(v.boolean()),
    }),
    lastError: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query('chainConfig')
      .withIndex('by_network', (q) => q.eq('network', args.network))
      .first()
    const row = { ...args, refreshedAt: Date.now() }
    if (!existing) {
      await ctx.db.insert('chainConfig', row)
    } else if (
      existing.coreContractId !== args.coreContractId ||
      existing.chainEpoch !== args.chainEpoch
    ) {
      // A new contract set: drop values read from the previous one.
      await ctx.db.replace(existing._id, row)
    } else {
      // Same set: a view that failed this time keeps its previous value.
      await ctx.db.patch(existing._id, {
        ...row,
        paused: { ...existing.paused, ...args.paused },
        lastError: args.lastError,
      })
    }
  },
})

/** Holders of an OpenZeppelin role, by `get_role_member_count` and index. */
async function readRoleMembers(
  rpc: RpcClient,
  chain: Pick<ChainEnv, 'passphrase'>,
  contractId: string,
  role: string
): Promise<string[]> {
  const symbol = xdr.ScVal.scvSymbol(role)
  const count = Number(
    await readView(rpc, chain, contractId, 'get_role_member_count', [symbol])
  )
  if (!Number.isInteger(count) || count < 0 || count > 50) {
    throw new Error(`get_role_member_count: ${count}`)
  }
  const members: string[] = []
  for (let i = 0; i < count; i++) {
    members.push(
      String(
        await readView(rpc, chain, contractId, 'get_role_member', [
          symbol,
          nativeToScVal(i, { type: 'u32' }),
        ])
      )
    )
  }
  return members
}

/** Simulates a read-only call and returns the native return value. */
export async function readView(
  rpc: RpcClient,
  chain: Pick<ChainEnv, 'passphrase'>,
  contractId: string,
  method: string,
  args: xdr.ScVal[] = []
): Promise<unknown> {
  const tx = new TransactionBuilder(new Account(VIEW_SOURCE, '0'), {
    fee: '100',
    networkPassphrase: chain.passphrase,
  })
    .addOperation(new Contract(contractId).call(method, ...args))
    .setTimeout(30)
    .build()
  const result = await rpc.simulateTransaction(tx.toXdr())
  if (result.error || !result.retvalXdr) {
    throw new Error(`${method}: ${result.error ?? 'no return value'}`)
  }
  return scValToNative(xdr.ScVal.fromXdr(result.retvalXdr, 'base64'))
}

/**
 * Hourly cron. Does nothing until `CORE_CONTRACT_ID` is set. A failed view
 * keeps the previous value and records `lastError`.
 */
export const refreshChainConfig = internalAction({
  args: {},
  handler: async (ctx) => {
    const chain = readChainEnv()
    if (!chain.coreContractId) return { refreshed: false }
    const rpc = createBackendRpcClient()
    const errors: string[] = []
    const attempt = async <T>(fn: () => Promise<T>): Promise<T | undefined> => {
      try {
        return await fn()
      } catch (error) {
        errors.push(error instanceof Error ? error.message : String(error))
        return undefined
      }
    }

    const core = chain.coreContractId
    const minTip = chain.tokenContractId
      ? await attempt(async () =>
          String(
            await readView(rpc, chain, core, 'min_tip', [
              new Address(chain.tokenContractId!).toScVal(),
            ])
          )
        )
      : undefined
    const feeBps = await attempt(async () =>
      Number(await readView(rpc, chain, core, 'fee_bps'))
    )
    const paused = {
      core: await attempt(async () =>
        Boolean(await readView(rpc, chain, core, 'paused'))
      ),
      ...(chain.tabContractId
        ? {
            tab: await attempt(async () =>
              Boolean(
                await readView(rpc, chain, chain.tabContractId!, 'paused')
              )
            ),
          }
        : {}),
      ...(chain.nftContractId
        ? {
            nft: await attempt(async () =>
              Boolean(
                await readView(rpc, chain, chain.nftContractId!, 'paused')
              )
            ),
          }
        : {}),
    }
    // Tab tip readiness compares TAB_SETTLER_SECRET with these.
    const tabSettlers = chain.tabContractId
      ? await attempt(() =>
          readRoleMembers(rpc, chain, chain.tabContractId!, 'settler')
        )
      : undefined
    const threshold = chain.nftContractId
      ? await attempt(async () => {
          const value = await readView(
            rpc,
            chain,
            chain.nftContractId!,
            'threshold'
          )
          return Array.isArray(value)
            ? { token: String(value[0]), amount: String(value[1]) }
            : { token: undefined, amount: String(value) }
        })
      : undefined
    const nftThreshold = threshold?.amount
    const nftThresholdToken = threshold?.token

    const tabAcceptorKeys = chain.tabContractId
      ? await attempt(() =>
          readTabAcceptorKeys(rpc, chain, chain.tabContractId!)
        )
      : undefined
    // Acceptance refuses on a mismatch (tabs.submitTip); this makes it visible.
    if (tabAcceptorKeys) {
      let acceptor: string | null = null
      try {
        acceptor = loadAcceptor().publicKey
      } catch (error) {
        // With settlement off, acceptance is off and there is nothing to
        // check. With it on, a missing or malformed secret refuses every tab
        // tip (TAB_ACCEPTOR_UNAVAILABLE), so report it here too. The message
        // is fixed text: it never holds the secret.
        if (process.env.SETTLEMENT_ENABLED?.trim() === 'true') {
          const message = acceptorErrorMessage(error)
          console.error(
            JSON.stringify({ code: 'TAB_ACCEPTOR_UNAVAILABLE', message })
          )
          errors.push(`TAB_ACCEPTOR_UNAVAILABLE: ${message}`)
        }
      }
      if (acceptor && !tabAcceptorKeys.includes(acceptor)) {
        console.error(
          JSON.stringify({
            code: 'TAB_ACCEPTOR_MISMATCH',
            acceptor,
            tabAcceptorKeys,
          })
        )
      }
    }

    const defined = <T extends Record<string, unknown>>(o: T) =>
      Object.fromEntries(
        Object.entries(o).filter(([, value]) => value !== undefined)
      ) as Partial<T>
    await ctx.runMutation(internal.chain.config.storeChainConfig, {
      network: chain.network,
      chainEpoch: chain.chainEpoch,
      ...defined({
        coreContractId: chain.coreContractId ?? undefined,
        tabContractId: chain.tabContractId ?? undefined,
        nftContractId: chain.nftContractId ?? undefined,
        tokenContractId: chain.tokenContractId ?? undefined,
        minTip,
        feeBps,
        nftThreshold,
        nftThresholdToken,
        tabAcceptorKeys,
        tabSettlers,
        lastError: errors.length ? errors.join('; ').slice(0, 500) : undefined,
      }),
      paused: defined(paused),
    })
    if (chain.v2Enabled) {
      // One line per cause, with its own code; never a secret or a key.
      const readiness = await ctx.runQuery(internal.chain.tabReadiness.read, {})
      for (const cause of readiness.causes) {
        console.error(
          JSON.stringify({ code: readinessLogCode(cause), source: 'refresh' })
        )
      }
    }
    return { refreshed: true, errors }
  },
})

/** Tab `config().acceptor_keys`, as lowercase hex (current first). */
async function readTabAcceptorKeys(
  rpc: RpcClient,
  chain: Pick<ChainEnv, 'passphrase'>,
  tabContractId: string
): Promise<string[]> {
  const config = (await readView(rpc, chain, tabContractId, 'config')) as {
    acceptor_keys?: unknown
  }
  if (!Array.isArray(config.acceptor_keys)) {
    throw new Error('config: acceptor_keys is not a list')
  }
  return config.acceptor_keys.map((key) => {
    if (!(key instanceof Uint8Array) || key.length !== 32) {
      throw new Error('config: acceptor key is not 32 bytes')
    }
    return bytesToHex(key)
  })
}

/** The fixed message of an acceptor refusal; never the secret. */
function acceptorErrorMessage(error: unknown): string {
  if (error instanceof ConvexError) {
    const data = error.data as { message?: unknown } | undefined
    if (typeof data?.message === 'string') return data.message
  }
  return error instanceof Error ? error.message : 'acceptor unavailable'
}

/**
 * Check of the saved acceptor secret before v2 is switched on (cutover
 * runbook, stage 3). It derives the public key from `TAB_ACCEPTOR_SECRET`
 * exactly as acceptance does (`acceptorPublicKeyHex`), reads the Tab contract's
 * `acceptor_keys` now, and compares them. It works with settlement on or
 * off. It returns the public key and the listed keys only, never the secret,
 * and writes nothing.
 *
 * `status`: `listed` (ready), `not_listed` (a valid seed of another key),
 * `malformed` (acceptance would refuse with `TAB_ACCEPTOR_UNAVAILABLE`),
 * `unset`, or `keys_unread` (no Tab contract set, or the view failed).
 * `whitespace` is true when the saved value has white space around it;
 * acceptance trims it, but the runbook's field check does not allow it.
 */
export const checkAcceptor = internalAction({
  args: {},
  returns: v.object({
    status: v.union(
      v.literal('listed'),
      v.literal('not_listed'),
      v.literal('malformed'),
      v.literal('unset'),
      v.literal('keys_unread')
    ),
    publicKey: v.union(v.string(), v.null()),
    acceptorKeys: v.union(v.array(v.string()), v.null()),
    whitespace: v.boolean(),
    error: v.optional(v.string()),
  }),
  handler: async () => {
    assertBackendTestnet()
    const secret = process.env.TAB_ACCEPTOR_SECRET ?? ''
    const whitespace = secret !== secret.trim()
    if (!secret.trim()) {
      return {
        status: 'unset' as const,
        publicKey: null,
        acceptorKeys: null,
        whitespace,
      }
    }
    let publicKey: string
    try {
      publicKey = acceptorPublicKeyHex(secret)
    } catch (error) {
      return {
        status: 'malformed' as const,
        publicKey: null,
        acceptorKeys: null,
        whitespace,
        error: acceptorErrorMessage(error),
      }
    }
    const chain = readChainEnv()
    if (!chain.tabContractId) {
      return {
        status: 'keys_unread' as const,
        publicKey,
        acceptorKeys: null,
        whitespace,
        error: 'TAB_CONTRACT_ID is not set',
      }
    }
    let acceptorKeys: string[]
    try {
      acceptorKeys = await readTabAcceptorKeys(
        createBackendRpcClient(),
        chain,
        chain.tabContractId
      )
    } catch (error) {
      return {
        status: 'keys_unread' as const,
        publicKey,
        acceptorKeys: null,
        whitespace,
        error: error instanceof Error ? error.message : String(error),
      }
    }
    return {
      status: acceptorKeys.includes(publicKey)
        ? ('listed' as const)
        : ('not_listed' as const),
      publicKey,
      acceptorKeys,
      whitespace,
    }
  },
})
