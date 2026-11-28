/// <reference types="vite/client" />
/**
 * The practice treasury's actions (convex/practice.ts) end to end against a
 * fake RPC node: the readiness check that fails closed, the public answer,
 * a grant's record before its send, what the client is told, and how the
 * reconciler closes grants. Each test names the rule it proves.
 */
import { convexTest } from 'convex-test'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

type SendMode = 'pending' | 'error' | 'throws'
type GetMode = 'not_found' | 'success' | 'failed'
type Union = { type: string } & Record<string, unknown>

const node = vi.hoisted(() => ({
  send: 'pending' as SendMode,
  get: 'success' as GetMode,
  closeTime: 0,
  oldestCloseTime: 0,
  balance: '200000000000',
  grantor: true,
  rpcThrows: '',
  sent: [] as string[],
  simulated: [] as string[],
  reset() {
    this.send = 'pending'
    this.get = 'success'
    this.closeTime = 0
    this.oldestCloseTime = 0
    this.balance = '200000000000'
    this.grantor = true
    this.rpcThrows = ''
    this.sent = []
    this.simulated = []
  },
}))

vi.mock('@stellar/stellar-sdk', async (importOriginal) => {
  const m = (await importOriginal()) as typeof import('@stellar/stellar-sdk')
  class Server {
    constructor(public url: string) {}
    async getAccount(id: string) {
      return new m.Account(id, '1')
    }
    async getAccountEntry() {
      if (node.rpcThrows) throw new Error(node.rpcThrows)
      return { balance: node.balance }
    }
    async getLatestLedger() {
      return { sequence: 1000 }
    }
    async simulateTransaction(tx: { operations: { func?: unknown }[] }) {
      const func = tx.operations[0]?.func as Union | undefined
      const name =
        func?.type === 'hostFunctionTypeInvokeContract'
          ? String(
              (func.invokeContract as { functionName: unknown }).functionName
            )
          : 'other'
      node.simulated.push(name)
      const retval =
        name === 'has_role'
          ? node.grantor
            ? m.nativeToScVal(0, { type: 'u32' })
            : m.xdr.ScVal.scvVoid()
          : name === 'grant_session'
            ? m.nativeToScVal(0, { type: 'u32' })
            : m.xdr.ScVal.scvVoid()
      return {
        _parsed: true,
        id: '1',
        latestLedger: 1000,
        events: [],
        minResourceFee: '1300000',
        transactionData: new m.SorobanDataBuilder().setResourceFee(
          BigInt(1_300_000)
        ),
        result: { auth: [], retval },
      }
    }
    async sendTransaction(tx: { hash(): Uint8Array }) {
      const hash = Buffer.from(tx.hash()).toString('hex')
      node.sent.push(hash)
      if (node.send === 'throws') throw new Error('socket hang up')
      return { status: node.send === 'error' ? 'ERROR' : 'PENDING', hash }
    }
    async getTransaction() {
      if (node.get === 'not_found')
        return {
          status: 'NOT_FOUND',
          latestLedger: 900,
          latestLedgerCloseTime: String(node.closeTime),
          oldestLedgerCloseTime: String(node.oldestCloseTime),
        }
      return {
        status: node.get === 'success' ? 'SUCCESS' : 'FAILED',
        ledger: 1001,
        resultXdr: { feeCharged: 1_337_066 },
        returnValue: m.nativeToScVal(0, { type: 'u32' }),
      }
    }
  }
  return { ...m, rpc: { ...m.rpc, Server } }
})

import { Keypair, StrKey } from '@stellar/stellar-sdk'
import { Buffer } from 'buffer'
import schema from '../../convex/schema'
import { api, internal } from '../../convex/_generated/api'

const modules = import.meta.glob('../../convex/**/*.ts')
const PASSPHRASE = 'Test SDF Network ; September 2015'
const TAB = StrKey.encodeContract(Buffer.alloc(32, 21))
const READER = StrKey.encodeContract(Buffer.alloc(32, 7))
const DEVICE = 'ab'.repeat(32)
type T = ReturnType<typeof convexTest>

/** A throwaway key made for the test; its secret only reaches the stubbed env. */
let treasury = Keypair.random()

function env(over: Record<string, string | undefined>) {
  const base: Record<string, string | undefined> = {
    STELLAR_NETWORK: 'TESTNET',
    STELLAR_RPC_URL: 'http://127.0.0.1:9',
    PRACTICE_GRANTS_ENABLED: 'true',
    TAB_CONTRACT_ID: TAB,
    PRACTICE_TREASURY_PUBLIC_KEY: treasury.publicKey(),
    PRACTICE_TREASURY_SECRET: treasury.secret(),
    SPONSOR_ENABLED: 'true',
    ...over,
  }
  for (const [k, v] of Object.entries(base)) vi.stubEnv(k, v ?? '')
}

async function setup(over: Record<string, string | undefined> = {}) {
  node.reset()
  treasury = Keypair.random()
  env(over)
  const t = convexTest(schema, modules)
  const now = Date.now()
  await t.run(async (ctx) => {
    await ctx.db.insert('xlmPriceCache', {
      priceUsd: 0.1273,
      source: 'test',
      fetchedAt: now,
    } as never)
  })
  const id = await t.run((ctx) =>
    ctx.db.insert('users', {
      username: 'reader1',
      email: 'reader1@example.test',
      stellarAddress: READER,
      stellarAddressVerifiedAt: now,
      stellarAddressVerifiedNetwork: PASSPHRASE,
      createdAt: now,
      updatedAt: now,
    })
  )
  return { t, as: t.withIdentity({ subject: `${id}|s1` }) }
}

async function outcome(p: Promise<unknown>) {
  try {
    return { code: 'ALLOWED', message: '', value: await p }
  } catch (e) {
    const data = (e as { data?: { code?: string; message?: string } }).data
    return {
      code: data?.code ?? 'THROWN',
      message: data?.message ?? String((e as Error).message),
      value: null,
    }
  }
}

const first = (as: ReturnType<T['withIdentity']>) =>
  outcome(as.action(api.practice.grantFirst, { devicePublicKey: DEVICE }))
const grants = (t: T) =>
  t.run(async (ctx) => ctx.db.query('practiceGrants').collect())
const given = (t: T) =>
  t.run(async (ctx) =>
    (await ctx.db.query('practiceDays').collect()).map((d) => d.givenStroops)
  )

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(() => Promise.reject(new Error('no network in tests')))
  )
})
afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

describe('the treasury readiness fails closed', () => {
  const cases: [
    string,
    () => Record<string, string | undefined>,
    () => void,
    string,
  ][] = [
    [
      'a malformed secret',
      () => ({ PRACTICE_TREASURY_SECRET: 'SNOTASECRET' }),
      () => {},
      'secret_invalid',
    ],
    [
      'a secret for another address',
      () => ({ PRACTICE_TREASURY_PUBLIC_KEY: Keypair.random().publicKey() }),
      () => {},
      'secret_mismatch',
    ],
    [
      'a treasury that is not the grantor',
      () => ({}),
      () => {
        node.grantor = false
      },
      'not_grantor',
    ],
    [
      'a balance under the floor plus one gift',
      () => ({}),
      () => {
        node.balance = '10000000001'
      },
      'below_floor_plus_gift',
    ],
  ]

  for (const [name, over, arrange, failed] of cases) {
    it(`${name}: not ready, the public answer is false, and no grant is signed`, async () => {
      const { t, as } = await setup(over())
      arrange()
      const r = await t.action(internal.practice.checkReadiness, {})
      expect(r?.ready).toBe(false)
      expect(r?.failed).toContain(failed)
      expect(await t.query(api.sponsorStore.passkeyTipAvailable, {})).toBe(
        false
      )
      const g = await first(as)
      expect(g.code).toBe('PRACTICE_NOT_READY')
      expect(g.message).toBe('Practice money is not available right now.')
      expect(node.simulated.filter((f) => f.startsWith('grant'))).toEqual([])
      expect(node.sent).toEqual([])
      // The refused grant gives its place in the day back.
      expect((await grants(t))[0]!.status).toBe('failed')
      expect(await given(t)).toEqual(['0'])
    })
  }

  it('ready: a signed simulation of has_role ran, nothing was sent, and with the sponsor ready the public answer is true', async () => {
    const { t } = await setup()
    const r = await t.action(internal.practice.checkReadiness, {})
    expect(r).toMatchObject({ ready: true, failed: [] })
    expect(r?.warnings).toEqual(['no_confirmed_grant_yet'])
    expect(node.simulated).toEqual(['has_role'])
    expect(node.sent).toEqual([])
    await t.mutation(internal.sponsorStore.recordReadiness, {
      service: 'sponsor',
      ready: true,
      failed: [],
      warnings: [],
      fingerprint: 'f',
    })
    expect(await t.query(api.sponsorStore.passkeyTipAvailable, {})).toBe(true)
  })
})

describe('a grant is recorded before it is sent', () => {
  it('confirmed: sent with key 0, and the cap is the whole gift', async () => {
    const { t, as } = await setup()
    const g = await first(as)
    expect(g.code).toBe('ALLOWED')
    const v = g.value as { keyId: number; amount: string; spendLimit: string }
    expect(v.keyId).toBe(0)
    expect(v.spendLimit).toBe(v.amount)
    expect((await grants(t))[0]).toMatchObject({ status: 'sent', keyId: 0 })
  })

  it('a send that throws leaves the grant pending with its hash, and the client is told to wait', async () => {
    const { t, as } = await setup()
    node.send = 'throws'
    const g = await first(as)
    expect(g.code).toBe('PRACTICE_PENDING')
    expect(g.message).toBe('Waiting for Stellar testnet to confirm it.')
    const [row] = await grants(t)
    expect(row).toMatchObject({ status: 'pending', txHash: node.sent[0] })
    expect(row!.maxTime).toBeGreaterThan(Math.floor(Date.now() / 1000))
  })

  it('the node refusing it fails the grant, gives the budget back, and says nothing was sent', async () => {
    const { t, as } = await setup()
    node.send = 'error'
    const g = await first(as)
    expect(g.code).toBe('SPONSOR_SEND_REFUSED')
    expect(g.message).toBe('That did not go through. Nothing was sent.')
    expect((await grants(t))[0]!.status).toBe('failed')
    expect(await given(t)).toEqual(['0'])
  })
})

describe('the reconciler closes grants by the chain', () => {
  async function pending() {
    const s = await setup()
    node.send = 'throws'
    await first(s.as)
    const [row] = await grants(s.t)
    await s.t.run(async (ctx) =>
      ctx.db.patch(row!._id, { updatedAt: Date.now() - 200_000 })
    )
    return { ...s, row: row! }
  }

  it('not found before the time bound stays pending; success later finishes it with key 0', async () => {
    const { t, row } = await pending()
    node.get = 'not_found'
    node.closeTime = row.maxTime! - 1
    vi.stubEnv('PRACTICE_GRANTS_ENABLED', 'false')
    await t.action(internal.practice.reconcile, {})
    expect((await grants(t))[0]!.status).toBe('pending')
    node.get = 'success'
    await t.action(internal.practice.reconcile, {})
    expect((await grants(t))[0]).toMatchObject({ status: 'sent', keyId: 0 })
  })

  it('not found past the time bound fails it and gives the budget back', async () => {
    const { t, row } = await pending()
    node.get = 'not_found'
    node.closeTime = row.maxTime! + 1
    await t.action(internal.practice.reconcile, {})
    expect((await grants(t))[0]).toMatchObject({
      status: 'failed',
      error: 'PRACTICE_NOT_LANDED',
    })
    expect(await given(t)).toEqual(['0'])
  })
})

describe('nothing but codes in the log lines a public caller can receive', () => {
  function captureLogs() {
    const lines: string[] = []
    const grab = (...a: unknown[]) => {
      lines.push(
        a.map((x) => (x instanceof Error ? x.message : String(x))).join(' ')
      )
    }
    for (const level of ['error', 'warn', 'log', 'info'] as const) {
      vi.spyOn(console, level).mockImplementation(grab)
    }
    return lines
  }
  afterEach(() => vi.restoreAllMocks())

  it('a treasury under the floor at grant time: a fixed sentence, no figures', async () => {
    const { t, as } = await setup()
    await t.action(internal.practice.checkReadiness, {})
    node.balance = '5'
    const lines = captureLogs()
    const g = await first(as)
    expect(g.code).toBe('PRACTICE_EMPTY')
    expect(g.message).toBe('Practice money is not available right now.')
    expect(lines.join('\n')).not.toMatch(/10000000000|\b5\b.*floor|floor/)
    expect(lines.join('\n')).toContain('PRACTICE_EMPTY')
  })

  it('an RPC failure with host and token in its text', async () => {
    const { as } = await setup()
    node.rpcThrows = 'MARKER rpc-internal.example:8000 token=abc'
    const lines = captureLogs()
    const g = await first(as)
    expect(g.message).not.toMatch(/MARKER|rpc-internal|token=/)
    expect(lines.join('\n')).not.toMatch(/MARKER|rpc-internal|token=/)
  })
})

describe('the same browser asking again', () => {
  it('gets its first grant back while it is sent, and "still pending" while it is pending', async () => {
    const { t, as } = await setup()
    const one = await first(as)
    expect(one.code).toBe('ALLOWED')
    const again = await first(as)
    expect(again.code).toBe('ALLOWED')
    expect(again.value).toMatchObject({
      txHash: (one.value as { txHash: string }).txHash,
      keyId: 0,
      amount: (one.value as { amount: string }).amount,
      spendLimit: (one.value as { amount: string }).amount,
    })
    // Only one grant was sent.
    expect(node.sent).toHaveLength(1)
    // While pending, the answer is to wait.
    await t.run(async (ctx) => {
      const row = (await ctx.db.query('practiceGrants').collect())[0]!
      await ctx.db.patch(row._id, { status: 'pending' })
    })
    const waiting = await first(as)
    expect(waiting.code).toBe('PRACTICE_PENDING')
    expect(waiting.message).toBe('Waiting for Stellar testnet to confirm it.')
  })

  it('another device key is refused: the gift belongs to the first browser', async () => {
    const { as } = await setup()
    await first(as)
    const other = await outcome(
      as.action(api.practice.grantFirst, { devicePublicKey: 'cd'.repeat(32) })
    )
    expect(other.code).toBe('PRACTICE_ALREADY_STARTED')
    expect(node.sent).toHaveLength(1)
  })
})

describe('"not found" proves nothing outside the node history window', () => {
  it('a node whose history starts after the signing time leaves the grant pending', async () => {
    const s = await setup()
    node.send = 'throws'
    await first(s.as)
    const [row] = await grants(s.t)
    await s.t.run(async (ctx) =>
      ctx.db.patch(row!._id, { updatedAt: Date.now() - 200_000 })
    )
    node.get = 'not_found'
    node.closeTime = row!.maxTime! + 1000
    node.oldestCloseTime = row!.signedAt! + 300
    await s.t.action(internal.practice.reconcile, {})
    expect((await grants(s.t))[0]!.status).toBe('pending')
    node.get = 'success'
    await s.t.action(internal.practice.reconcile, {})
    expect((await grants(s.t))[0]).toMatchObject({ status: 'sent', keyId: 0 })
  })
})
