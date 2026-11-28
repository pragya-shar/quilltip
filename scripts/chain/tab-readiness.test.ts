/// <reference types="vite/client" />
/**
 * Tab tip readiness (#692): tab features are offered only while the keys,
 * settlement and the Tab's state allow them. Each cause alone gives "not
 * ready" with its own code; no return value or log line holds secret
 * material; a corrected secret counts without a redeploy.
 */
import { convexTest } from 'convex-test'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Buffer } from 'buffer'
import { Address, Keypair, nativeToScVal, xdr } from '@stellar/stellar-sdk'
import schema from '../../convex/schema'
import { api, internal } from '../../convex/_generated/api'
import type { Id } from '../../convex/_generated/dataModel'
import {
  TAB_READINESS_CAUSES,
  acceptorKeyOf,
  readinessLogCode,
  settlerAddressOf,
  type TabReadinessCause,
} from '../../convex/lib/chain/tabReadiness'
import { insertTabAccount } from '../../convex/lib/chain/tabLedger'
import { settlerKeypair } from '../../convex/tabSettler'
import shared from '../../contracts/shared/test-vectors.json'
import { fakeRpcFetch } from './fixtures'

const modules = import.meta.glob('../../convex/**/*.ts')

const EPOCH = 'testnet-ready'
const PASSPHRASE = shared.network.passphrase
const TAB = shared.tab_contract
const TOKEN = 'CAJS4RVGLFL2ANWW7W6Q4RGOZQXSVXW5BQKJ7A3ISE4EOUM5HHO77CQL'
const CORE = 'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAOLZM'
const ACCEPTOR_SEED = shared.keys.acceptor.seed
const ACCEPTOR_PUBLIC = shared.keys.acceptor.public_key
const SETTLER = Keypair.fromRawEd25519Seed(new Uint8Array(32).fill(61))
const OTHER = Keypair.fromRawEd25519Seed(new Uint8Array(32).fill(62))
const READER = Keypair.fromRawEd25519Seed(new Uint8Array(32).fill(63))
const LEDGER = 7_000_000
const T0 = Date.UTC(2026, 11, 2, 12, 0, 0)

/** Every secret value the tests set; none may appear in any output. */
const SECRETS = [
  SETTLER.secret(),
  OTHER.secret(),
  ACCEPTOR_SEED,
  'ef'.repeat(32),
  // Malformed values, also never echoed.
  `${SETTLER.secret().slice(0, -1)}A`,
  'not-a-hex-seed-0123456789',
]

beforeEach(() => {
  vi.useFakeTimers({ now: T0 })
  for (const [k, v] of Object.entries({
    STELLAR_NETWORK: 'TESTNET',
    NETWORK_PASSPHRASE: PASSPHRASE,
    CHAIN_V2_ENABLED: 'true',
    CHAIN_EPOCH: EPOCH,
    TAB_CONTRACT_ID: TAB,
    TOKEN_CONTRACT_ID: TOKEN,
    SETTLEMENT_ENABLED: 'true',
    TAB_ACCEPTOR_SECRET: ACCEPTOR_SEED,
    TAB_SETTLER_SECRET: SETTLER.secret(),
  })) {
    vi.stubEnv(k, v)
  }
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

type T = ReturnType<typeof convexTest>

async function seed(t: T) {
  return t.run(async (ctx) => {
    await ctx.db.insert('chainConfig', {
      network: 'TESTNET',
      chainEpoch: EPOCH,
      tabContractId: TAB,
      tokenContractId: TOKEN,
      minTip: '100000',
      feeBps: 250,
      tabAcceptorKeys: [ACCEPTOR_PUBLIC],
      tabSettlers: [SETTLER.publicKey()],
      paused: { core: false, tab: false },
      refreshedAt: T0,
    })
    await ctx.db.insert('chainCursor', {
      network: 'TESTNET',
      chainEpoch: EPOCH,
      lastLedger: LEDGER,
      lastLedgerCloseTime: Math.floor(T0 / 1000),
      latestLedger: LEDGER,
      oldestLedger: LEDGER - 100_000,
      lagLedgers: 0,
      status: 'OK',
      updatedAt: T0,
    })
    const user = (name: string, address: string) =>
      ctx.db.insert('users', {
        username: name,
        email: `${name}@example.test`,
        stellarAddress: address,
        stellarAddressVerifiedAt: T0,
        stellarAddressVerifiedNetwork: PASSPHRASE,
        createdAt: T0,
        updatedAt: T0,
      })
    return {
      readerId: await user('reader', READER.publicKey()),
      opsId: await user('operator', OTHER.publicKey()),
    }
  })
}

const as = (t: T, userId: Id<'users'>) =>
  t.withIdentity({ subject: `${userId}|session` })

async function errorCode(promise: Promise<unknown>): Promise<string> {
  try {
    await promise
  } catch (error) {
    const data = (error as { data?: unknown }).data
    const parsed = typeof data === 'string' ? JSON.parse(data) : data
    return (parsed as { code?: string })?.code ?? String(error)
  }
  return 'no error'
}

async function patchConfig(
  t: T,
  patch: Record<string, unknown> | null
): Promise<void> {
  await t.run(async (ctx) => {
    const row = (await ctx.db.query('chainConfig').first())!
    if (patch === null) await ctx.db.delete(row._id)
    else await ctx.db.patch(row._id, patch)
  })
}

/** Every read a reader, a watcher or an operator gets, as one string. */
async function everyOutput(t: T, opsId: Id<'users'>) {
  return JSON.stringify([
    await t.query(api.chain.config.getChainConfig, {}),
    await t.query(api.tabActivity.getTabSettlement, {}),
    await t.query(internal.chain.tabReadiness.read, {}),
    await as(t, opsId).query(api.chain.tabReadiness.getTabReadiness, {}),
  ])
}

function expectNoSecret(text: string) {
  for (const secret of SECRETS) expect(text).not.toContain(secret)
}

/** Each cause, set up alone on a ready deployment. */
const CASES: Array<{
  cause: TabReadinessCause
  setUp: (t: T) => Promise<void>
}> = [
  {
    cause: 'settlement_off',
    setUp: async () => void vi.stubEnv('SETTLEMENT_ENABLED', 'false'),
  },
  { cause: 'config_missing', setUp: (t) => patchConfig(t, null) },
  { cause: 'paused', setUp: (t) => patchConfig(t, { paused: { tab: true } }) },
  {
    cause: 'settler_unset',
    setUp: async () => void vi.stubEnv('TAB_SETTLER_SECRET', '  '),
  },
  {
    cause: 'settler_malformed',
    setUp: async () =>
      void vi.stubEnv(
        'TAB_SETTLER_SECRET',
        `${SETTLER.secret().slice(0, -1)}A`
      ),
  },
  {
    cause: 'settler_not_listed',
    setUp: async () => void vi.stubEnv('TAB_SETTLER_SECRET', OTHER.secret()),
  },
  {
    cause: 'acceptor_unset',
    setUp: async () => void vi.stubEnv('TAB_ACCEPTOR_SECRET', ''),
  },
  {
    cause: 'acceptor_malformed',
    setUp: async () =>
      void vi.stubEnv('TAB_ACCEPTOR_SECRET', 'not-a-hex-seed-0123456789'),
  },
  {
    cause: 'acceptor_not_listed',
    setUp: async () => void vi.stubEnv('TAB_ACCEPTOR_SECRET', 'ef'.repeat(32)),
  },
]

describe('tab tip readiness (#692)', () => {
  it('covers every cause once', () => {
    expect(CASES.map((c) => c.cause)).toEqual([...TAB_READINESS_CAUSES])
    expect(TAB_READINESS_CAUSES.map(readinessLogCode)).toContain(
      'TAB_NOT_READY_SETTLER_MALFORMED'
    )
  })

  it('is ready when every check passes; the public reads carry one boolean', async () => {
    const t = convexTest(schema, modules)
    const s = await seed(t)
    vi.stubEnv('OPS_USER_IDS', String(s.opsId))
    expect(await t.query(internal.chain.tabReadiness.read, {})).toMatchObject({
      ready: true,
      causes: [],
      v2Enabled: true,
    })
    const config = await t.query(api.chain.config.getChainConfig, {})
    expect(config.tabReady).toBe(true)
    expect(await t.query(api.tabActivity.getTabSettlement, {})).toEqual({
      settlementEnabled: true,
      tabReady: true,
    })
    // Operators only see the causes.
    expect(await t.query(api.chain.tabReadiness.getTabReadiness, {})).toBeNull()
    expect(
      await as(t, s.readerId).query(api.chain.tabReadiness.getTabReadiness, {})
    ).toBeNull()
    expect(
      await as(t, s.opsId).query(api.chain.tabReadiness.getTabReadiness, {})
    ).toMatchObject({ ready: true, causes: [] })
    // Readiness does not include CHAIN_V2_ENABLED: it can be read before
    // the switch-on.
    vi.stubEnv('CHAIN_V2_ENABLED', 'false')
    expect((await t.query(api.chain.config.getChainConfig, {})).tabReady).toBe(
      true
    )
    expectNoSecret(await everyOutput(t, s.opsId))
  })

  for (const { cause, setUp } of CASES) {
    it(`${cause} alone: not ready, with its own code and no secret`, async () => {
      const t = convexTest(schema, modules)
      const s = await seed(t)
      vi.stubEnv('OPS_USER_IDS', String(s.opsId))
      await setUp(t)
      expect(await t.query(internal.chain.tabReadiness.read, {})).toMatchObject(
        { ready: false, causes: [cause] }
      )
      expect(
        (await t.query(api.chain.config.getChainConfig, {})).tabReady
      ).toBe(false)
      expect(
        (await t.query(api.tabActivity.getTabSettlement, {})).tabReady
      ).toBe(false)
      // The server refuses opening and top-ups with one code; the public
      // reads never say which check failed.
      expect(
        await errorCode(
          as(t, s.readerId).mutation(api.tabs.prepareOpen, {
            amount: '50000000',
            publicKey: 'ab'.repeat(32),
            validUntil: LEDGER + 1000,
            spendLimit: '50000000',
            extractable: false,
          })
        )
      ).toBe('TAB_NOT_READY')
      const text = await everyOutput(t, s.opsId)
      expectNoSecret(text)
      const publicText = JSON.stringify([
        await t.query(api.chain.config.getChainConfig, {}),
        await t.query(api.tabActivity.getTabSettlement, {}),
      ])
      expect(publicText).not.toContain('"causes"')
      // The pause state is public already (`getChainConfig.paused`).
      for (const c of TAB_READINESS_CAUSES.filter((c) => c !== 'paused')) {
        expect(publicText).not.toContain(`"${c}"`)
      }
      expect(
        Object.keys(await t.query(api.tabActivity.getTabSettlement, {}))
      ).toEqual(['settlementEnabled', 'tabReady'])
    })
  }

  it('other config gaps are config_missing: another Tab, another epoch, no role holders, no pause state', async () => {
    const t = convexTest(schema, modules)
    await seed(t)
    const causes = async () =>
      (await t.query(internal.chain.tabReadiness.read, {})).causes
    for (const patch of [
      { tabContractId: TOKEN },
      { chainEpoch: 'testnet-other' },
      { tabSettlers: undefined },
      { tabAcceptorKeys: undefined },
      { paused: { core: false } },
    ]) {
      const before = await t.run(
        async (ctx) => (await ctx.db.query('chainConfig').first())!
      )
      await patchConfig(t, patch)
      expect(await causes(), JSON.stringify(patch)).toEqual(['config_missing'])
      await t.run(async (ctx) => {
        const { _id, _creationTime, ...fields } = before
        void _creationTime
        await ctx.db.replace(_id, fields)
      })
      expect(await causes()).toEqual([])
    }
  })

  it('a secret corrected in the environment counts at once, without a redeploy', async () => {
    const t = convexTest(schema, modules)
    const s = await seed(t)
    vi.stubEnv('TAB_SETTLER_SECRET', `${SETTLER.secret().slice(0, -1)}A`)
    vi.stubEnv('TAB_ACCEPTOR_SECRET', 'not-a-hex-seed-0123456789')
    expect(
      (await t.query(internal.chain.tabReadiness.read, {})).causes
    ).toEqual(['settler_malformed', 'acceptor_malformed'])
    // Saved again in the dashboard: the next read sees it. No refresh and
    // no deploy in between.
    vi.stubEnv('TAB_SETTLER_SECRET', ` ${SETTLER.secret()} `)
    vi.stubEnv('TAB_ACCEPTOR_SECRET', ACCEPTOR_SEED)
    expect((await t.query(api.chain.config.getChainConfig, {})).tabReady).toBe(
      true
    )
    expect(
      await errorCode(
        as(t, s.readerId).mutation(api.tabs.prepareOpen, {
          amount: '50000000',
          publicKey: 'ab'.repeat(32),
          validUntil: LEDGER + 1000,
          spendLimit: '50000000',
          extractable: false,
        })
      )
    ).toBe('no error')
  })

  it('a top-up is refused while not ready and accepted once ready', async () => {
    const t = convexTest(schema, modules)
    const s = await seed(t)
    await t.run(async (ctx) => {
      await insertTabAccount(ctx, {
        network: 'TESTNET',
        chainEpoch: EPOCH,
        userId: s.readerId,
        readerAddress: READER.publicKey(),
        tabContractId: TAB,
        now: T0,
      })
    })
    const topUp = () =>
      errorCode(
        as(t, s.readerId).mutation(api.tabs.prepareDeposit, {
          amount: '10000000',
        })
      )
    vi.stubEnv('TAB_ACCEPTOR_SECRET', 'ef'.repeat(32))
    expect(await topUp()).toBe('TAB_NOT_READY')
    vi.stubEnv('TAB_ACCEPTOR_SECRET', ACCEPTOR_SEED)
    expect(await topUp()).toBe('no error')
  })

  it('leaving is never gated: a withdrawal start is not refused for readiness', async () => {
    const t = convexTest(schema, modules)
    const s = await seed(t)
    vi.stubEnv('TAB_SETTLER_SECRET', '')
    vi.stubEnv('SETTLEMENT_ENABLED', 'false')
    const code = await errorCode(
      as(t, s.readerId).mutation(api.tabs.prepareWithdrawStart, {})
    )
    expect(code).not.toBe('TAB_NOT_READY')
  })

  it('parses the settler secret as settlerKeypair does and the acceptor secret as acceptance does', () => {
    for (const value of [
      SETTLER.secret(),
      ` ${SETTLER.secret()}\n`,
      `${SETTLER.secret().slice(0, -1)}A`,
      'SABC',
      ACCEPTOR_SEED,
    ]) {
      let node: string | null
      try {
        node = settlerKeypair({ TAB_SETTLER_SECRET: value }).publicKey()
      } catch {
        node = null
      }
      const ours = settlerAddressOf(value)
      expect(ours.status === 'ok' ? ours.value : null, value).toBe(node)
    }
    expect(acceptorKeyOf(ACCEPTOR_SEED)).toEqual({
      status: 'ok',
      value: ACCEPTOR_PUBLIC,
    })
    expect(acceptorKeyOf(` ${ACCEPTOR_SEED} `).status).toBe('ok')
    expect(acceptorKeyOf('zz'.repeat(32)).status).toBe('malformed')
    expect(acceptorKeyOf(undefined).status).toBe('unset')
  })

  it('the hourly refresh stores the settler role holders and logs one code per cause, with no secret', async () => {
    const t = convexTest(schema, modules)
    vi.stubEnv('CORE_CONTRACT_ID', CORE)
    const u32 = (n: number) => nativeToScVal(n, { type: 'u32' })
    const i128 = (n: bigint) => nativeToScVal(n, { type: 'i128' })
    const fetch = fakeRpcFetch((method, params) => {
      if (method !== 'simulateTransaction') throw new Error(method)
      const bytes = Buffer.from(
        (params as { transaction: string }).transaction,
        'base64'
      )
      const fn = [
        'get_role_member_count',
        'get_role_member',
        'config',
        'paused',
        'fee_bps',
        'min_tip',
      ].find((name) => bytes.includes(Buffer.from(name)))
      const retval =
        fn === 'get_role_member_count'
          ? u32(1)
          : fn === 'get_role_member'
            ? new Address(SETTLER.publicKey()).toScVal()
            : fn === 'config'
              ? xdr.ScVal.scvMap([
                  new xdr.ScMapEntry({
                    key: xdr.ScVal.scvSymbol('acceptor_keys'),
                    val: xdr.ScVal.scvVec([
                      xdr.ScVal.scvBytes(Buffer.from(ACCEPTOR_PUBLIC, 'hex')),
                    ]),
                  }),
                ])
              : fn === 'paused'
                ? xdr.ScVal.scvBool(false)
                : fn === 'fee_bps'
                  ? u32(250)
                  : i128(BigInt(1_000_000))
      return {
        latestLedger: LEDGER,
        results: [{ xdr: retval.toXdr('base64') }],
      }
    })
    vi.stubGlobal('fetch', fetch)
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
    await t.action(internal.chain.config.refreshChainConfig, {})
    const row = await t.run(
      async (ctx) => (await ctx.db.query('chainConfig').first())!
    )
    expect(row.tabSettlers).toEqual([SETTLER.publicKey()])
    expect(row.lastError ?? null).toBeNull()
    expect((await t.query(api.chain.config.getChainConfig, {})).tabReady).toBe(
      true
    )
    const codes = () =>
      errors.mock.calls
        .map((c) => String(c[0]))
        .filter((l) => l.includes('TAB_NOT_READY_'))
    expect(codes()).toEqual([])

    vi.stubEnv('TAB_SETTLER_SECRET', `${SETTLER.secret().slice(0, -1)}A`)
    vi.stubEnv('TAB_ACCEPTOR_SECRET', 'ef'.repeat(32))
    await t.action(internal.chain.config.refreshChainConfig, {})
    expect(codes().map((l) => JSON.parse(l).code)).toEqual([
      'TAB_NOT_READY_SETTLER_MALFORMED',
      'TAB_NOT_READY_ACCEPTOR_NOT_LISTED',
    ])
    expectNoSecret(errors.mock.calls.flat().map(String).join('\n'))
  })
})
