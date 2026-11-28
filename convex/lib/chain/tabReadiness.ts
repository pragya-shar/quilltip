/**
 * Whether this deployment can accept and settle tab tips now. Tab features
 * (opening, top-ups, tab tips) are offered only while it is true; direct
 * wallet tips do not depend on it.
 *
 * Ready means every one of these holds:
 *
 * - `SETTLEMENT_ENABLED=true`;
 * - the cached chain config (`chainConfig`) describes this epoch and Tab
 *   contract, and has the Tab's acceptor keys, `settler` role holders and
 *   pause state;
 * - the Tab contract is not paused;
 * - `TAB_SETTLER_SECRET` parses as `settlerKeypair` parses it, and its
 *   address holds the Tab's `settler` role;
 * - `TAB_ACCEPTOR_SECRET` parses as acceptance parses it, and its public
 *   key (`acceptorPublicKeyHex`, the derivation acceptance uses) is one of
 *   the Tab's acceptor keys.
 *
 * It does not include `CHAIN_V2_ENABLED`, so it can be read before the
 * switch-on; tab features need both.
 *
 * The secrets are read from the environment on every evaluation, so a
 * corrected secret counts at once, without a redeploy. Chain state (role
 * holders, acceptor keys, pause) comes from the hourly cache; a refresh
 * (`chain/config:refreshChainConfig`) updates it at once.
 *
 * Nothing here returns or logs secret material: a cause names which check
 * failed, never a value. Only operators and the logs see causes; the public
 * reads see one boolean.
 */
import { ConvexError } from 'convex/values'
import { Keypair, StrKey } from '@stellar/stellar-sdk'
import type { Doc } from '../../_generated/dataModel'
import type { QueryCtx } from '../../_generated/server'
import { readChainEnv } from './env'
import { acceptorPublicKeyHex } from './voucher'

type EnvLike = Record<string, string | undefined>

/** In check order. Each has its own log code (`readinessLogCode`). */
export const TAB_READINESS_CAUSES = [
  'settlement_off',
  'config_missing',
  'paused',
  'settler_unset',
  'settler_malformed',
  'settler_not_listed',
  'acceptor_unset',
  'acceptor_malformed',
  'acceptor_not_listed',
] as const
export type TabReadinessCause = (typeof TAB_READINESS_CAUSES)[number]

export type TabReadiness = {
  ready: boolean
  causes: TabReadinessCause[]
}

/** `TAB_NOT_READY_SETTLER_MALFORMED` and so on. */
export function readinessLogCode(cause: TabReadinessCause): string {
  return `TAB_NOT_READY_${cause.toUpperCase()}`
}

type SecretState =
  | { status: 'unset' }
  | { status: 'malformed' }
  | { status: 'ok'; value: string }

/**
 * The settler's address from `TAB_SETTLER_SECRET`: a trimmed Stellar
 * secret seed, the rule `settlerKeypair` (`convex/tabSettler.ts`) applies.
 * It runs in the default runtime, so queries and mutations can call it;
 * `settlerKeypair` stays in the Node action that signs.
 */
export function settlerAddressOf(secret: string | undefined): SecretState {
  const value = secret?.trim()
  if (!value) return { status: 'unset' }
  if (!StrKey.isValidEd25519SecretSeed(value)) return { status: 'malformed' }
  return { status: 'ok', value: Keypair.fromSecret(value).publicKey() }
}

/** The acceptor's public key (hex) from `TAB_ACCEPTOR_SECRET`. */
export function acceptorKeyOf(secret: string | undefined): SecretState {
  if (!secret?.trim()) return { status: 'unset' }
  try {
    return {
      status: 'ok',
      value: acceptorPublicKeyHex(secret),
    }
  } catch {
    return { status: 'malformed' }
  }
}

/** Pure evaluation over the environment and the cached chain config. */
export function evaluateTabReadiness(
  env: EnvLike,
  config: Doc<'chainConfig'> | null
): TabReadiness {
  const chain = readChainEnv(env)
  const causes: TabReadinessCause[] = []
  if (env.SETTLEMENT_ENABLED?.trim() !== 'true') causes.push('settlement_off')

  const current =
    !!config &&
    !!chain.tabContractId &&
    config.chainEpoch === chain.chainEpoch &&
    config.tabContractId === chain.tabContractId
  const acceptorKeys = current ? config.tabAcceptorKeys : undefined
  const settlers = current ? config.tabSettlers : undefined
  const paused = current ? config.paused.tab : undefined
  if (!acceptorKeys || !settlers || paused === undefined) {
    causes.push('config_missing')
  }
  if (paused === true) causes.push('paused')

  const settler = settlerAddressOf(env.TAB_SETTLER_SECRET)
  if (settler.status === 'unset') causes.push('settler_unset')
  else if (settler.status === 'malformed') causes.push('settler_malformed')
  else if (settlers && !settlers.includes(settler.value)) {
    causes.push('settler_not_listed')
  }

  const acceptor = acceptorKeyOf(env.TAB_ACCEPTOR_SECRET)
  if (acceptor.status === 'unset') causes.push('acceptor_unset')
  else if (acceptor.status === 'malformed') causes.push('acceptor_malformed')
  else if (acceptorKeys && !acceptorKeys.includes(acceptor.value)) {
    causes.push('acceptor_not_listed')
  }

  return { ready: causes.length === 0, causes }
}

/** The cached chain config row for the configured network. */
export async function cachedChainConfig(
  ctx: QueryCtx,
  env: EnvLike = process.env
): Promise<Doc<'chainConfig'> | null> {
  const chain = readChainEnv(env)
  return ctx.db
    .query('chainConfig')
    .withIndex('by_network', (q) => q.eq('network', chain.network))
    .first()
}

export async function readTabReadiness(
  ctx: QueryCtx,
  env: EnvLike = process.env
): Promise<TabReadiness> {
  return evaluateTabReadiness(env, await cachedChainConfig(ctx, env))
}

/**
 * Refuses an operation that adds funds or acceptances to a tab while the
 * deployment is not ready. Withdrawals, cancellations and key revocations
 * never call it: a reader can always leave.
 */
export async function requireTabReady(
  ctx: QueryCtx,
  env: EnvLike = process.env
): Promise<void> {
  if (!(await readTabReadiness(ctx, env)).ready) {
    throw new ConvexError({
      code: 'TAB_NOT_READY',
      message: 'Quick tips are unavailable right now.',
    })
  }
}
