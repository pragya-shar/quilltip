/**
 * The acceptor check before v2 is switched on (cutover runbook, stage 3):
 * `chain/config:checkAcceptor` derives the public key of the saved
 * `TAB_ACCEPTOR_SECRET` as acceptance does and compares it with the Tab
 * contract's `acceptor_keys`, without returning the secret. The config
 * refresh reports a missing or malformed acceptor while settlement is on.
 */
import { convexTest } from 'convex-test'
import {
  Address,
  Keypair,
  Networks,
  StrKey,
  TransactionBuilder,
  nativeToScVal,
  xdr,
  type Transaction,
} from '@stellar/stellar-sdk'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import schema from '../../convex/schema'
import { internal } from '../../convex/_generated/api'
import { bytesToHex } from '../../convex/lib/chain/ids'
import { CORE, TOKEN, fakeRpcFetch } from './fixtures'

const modules = import.meta.glob('../../convex/**/*.ts')

const TAB = StrKey.encodeContract(new Uint8Array(32).fill(31))
const ACCEPTOR = Keypair.fromRawEd25519Seed(new Uint8Array(32).fill(41))
const OTHER = Keypair.fromRawEd25519Seed(new Uint8Array(32).fill(42))
const hexOf = (k: Keypair) => bytesToHex(new Uint8Array(k.rawPublicKey()))

beforeEach(() => {
  for (const [k, v] of Object.entries({
    STELLAR_NETWORK: 'TESTNET',
    CHAIN_EPOCH: 'testnet-acceptor',
    CORE_CONTRACT_ID: CORE,
    TAB_CONTRACT_ID: TAB,
    TOKEN_CONTRACT_ID: TOKEN,
  })) {
    vi.stubEnv(k, v)
  }
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

function viewOf(params: Record<string, unknown> | undefined) {
  const tx = TransactionBuilder.fromXdr(
    String(params?.transaction),
    Networks.TESTNET
  ) as Transaction
  const call = (
    tx.operations[0] as unknown as {
      func: {
        invokeContract: {
          contractAddress: xdr.ScAddress
          functionName: { toString(): string }
        }
      }
    }
  ).func.invokeContract
  return {
    contract: Address.fromScAddress(call.contractAddress).toString(),
    method: call.functionName.toString(),
  }
}

/** Tab `config` returns the given acceptor keys; every other view fails. */
function stubTab(acceptorKeys: Keypair[]) {
  const config = xdr.ScVal.scvMap([
    new xdr.ScMapEntry({
      key: xdr.ScVal.scvSymbol('acceptor_keys'),
      val: xdr.ScVal.scvVec(
        acceptorKeys.map((k) => nativeToScVal(Buffer.from(k.rawPublicKey())))
      ),
    }),
  ])
  vi.stubGlobal(
    'fetch',
    fakeRpcFetch((method, params) => {
      if (method !== 'simulateTransaction') throw new Error(method)
      const { contract, method: view } = viewOf(params)
      if (contract === TAB && view === 'config') {
        return {
          latestLedger: 1,
          results: [{ xdr: config.toXDR('base64') }],
        }
      }
      return { latestLedger: 1, error: `HostError: no ${view} in this test` }
    })
  )
}

async function check(secret: string | undefined) {
  if (secret === undefined) vi.stubEnv('TAB_ACCEPTOR_SECRET', '')
  else vi.stubEnv('TAB_ACCEPTOR_SECRET', secret)
  const t = convexTest(schema, modules)
  return t.action(internal.chain.config.checkAcceptor, {})
}

describe('chain/config:checkAcceptor', () => {
  it('reports a saved seed whose key the Tab lists, without the secret', async () => {
    stubTab([OTHER, ACCEPTOR])
    const result = await check(ACCEPTOR.secret())
    expect(result).toEqual({
      status: 'listed',
      publicKey: hexOf(ACCEPTOR),
      acceptorKeys: [hexOf(OTHER), hexOf(ACCEPTOR)],
      whitespace: false,
    })
    expect(JSON.stringify(result)).not.toContain(ACCEPTOR.secret())
  })

  it('reports a valid seed of another key as not listed', async () => {
    stubTab([OTHER])
    expect(await check(ACCEPTOR.secret())).toMatchObject({
      status: 'not_listed',
      publicKey: hexOf(ACCEPTOR),
      acceptorKeys: [hexOf(OTHER)],
    })
  })

  it('reports a malformed value, for example a quoted seed, without echoing it', async () => {
    stubTab([ACCEPTOR])
    const quoted = `"${ACCEPTOR.secret()}"`
    const result = await check(quoted)
    expect(result).toMatchObject({
      status: 'malformed',
      publicKey: null,
      acceptorKeys: null,
      error: 'TAB_ACCEPTOR_SECRET is not a valid ed25519 seed.',
    })
    expect(JSON.stringify(result)).not.toContain(ACCEPTOR.secret())
  })

  it('reports an unset secret', async () => {
    stubTab([ACCEPTOR])
    expect(await check(undefined)).toMatchObject({
      status: 'unset',
      publicKey: null,
    })
  })

  it('flags white space that acceptance would trim', async () => {
    stubTab([ACCEPTOR])
    expect(await check(` ${ACCEPTOR.secret()}\n`)).toMatchObject({
      status: 'listed',
      whitespace: true,
    })
  })

  it('reports keys_unread without a Tab contract', async () => {
    stubTab([ACCEPTOR])
    vi.stubEnv('TAB_CONTRACT_ID', '')
    expect(await check(ACCEPTOR.secret())).toMatchObject({
      status: 'keys_unread',
      publicKey: hexOf(ACCEPTOR),
      error: 'TAB_CONTRACT_ID is not set',
    })
  })
})

describe('chain/config:refreshChainConfig and the acceptor', () => {
  async function refresh() {
    const t = convexTest(schema, modules)
    const logged: string[] = []
    vi.spyOn(console, 'error').mockImplementation((line: unknown) => {
      logged.push(String(line))
    })
    await t.action(internal.chain.config.refreshChainConfig, {})
    const row = await t.run(({ db }) => db.query('chainConfig').first())
    return { logged, row }
  }

  it('logs TAB_ACCEPTOR_UNAVAILABLE for a malformed secret while settlement is on', async () => {
    stubTab([ACCEPTOR])
    vi.stubEnv('SETTLEMENT_ENABLED', 'true')
    vi.stubEnv('TAB_ACCEPTOR_SECRET', `"${ACCEPTOR.secret()}"`)
    const { logged, row } = await refresh()
    const line = logged.find((l) => l.includes('TAB_ACCEPTOR_UNAVAILABLE'))
    expect(line).toBeDefined()
    expect(line).not.toContain(ACCEPTOR.secret())
    expect(row?.lastError).toContain('TAB_ACCEPTOR_UNAVAILABLE')
    expect(row?.tabAcceptorKeys).toEqual([hexOf(ACCEPTOR)])
  })

  it('stays quiet about the acceptor while settlement is off', async () => {
    stubTab([ACCEPTOR])
    vi.stubEnv('SETTLEMENT_ENABLED', '')
    vi.stubEnv('TAB_ACCEPTOR_SECRET', 'not-a-seed')
    const { logged, row } = await refresh()
    expect(logged.some((l) => l.includes('TAB_ACCEPTOR'))).toBe(false)
    expect(row?.lastError ?? '').not.toContain('TAB_ACCEPTOR')
  })

  it('still logs TAB_ACCEPTOR_MISMATCH for a valid seed of another key', async () => {
    stubTab([OTHER])
    vi.stubEnv('SETTLEMENT_ENABLED', 'true')
    vi.stubEnv('TAB_ACCEPTOR_SECRET', ACCEPTOR.secret())
    const { logged } = await refresh()
    expect(logged.some((l) => l.includes('TAB_ACCEPTOR_MISMATCH'))).toBe(true)
    expect(logged.some((l) => l.includes('TAB_ACCEPTOR_UNAVAILABLE'))).toBe(
      false
    )
  })
})
