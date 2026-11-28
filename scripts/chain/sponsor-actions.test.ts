/// <reference types="vite/client" />
/**
 * The fee sponsor's actions (convex/sponsor.ts) end to end against a fake RPC
 * node: what each record says after each outcome of a send, what the client
 * is told, how the reconciler closes requests, the budget commitments, the
 * order of checks, and the readiness check that fails closed. Each test
 * names the rule it proves.
 */
import { convexTest } from 'convex-test'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

type SendMode = 'pending' | 'error' | 'try_again' | 'throws'
type GetMode = 'not_found' | 'success' | 'failed' | 'throws'

const node = vi.hoisted(() => {
  const st = {
    send: 'pending' as SendMode,
    get: 'not_found' as GetMode,
    /** The node's latest ledger close time (seconds) for "not found". */
    closeTime: 0,
    simFee: 80_000,
    feeCharged: 123_456,
    balance: '100000000000',
    codeExists: true,
    readerWasm: '',
    sent: [] as string[],
    /** Contract functions simulated, in order. */
    simulated: [] as string[],
    auth: (() => null) as () => unknown,
    reset() {
      this.send = 'pending'
      this.get = 'not_found'
      this.closeTime = 0
      this.simFee = 80_000
      this.feeCharged = 123_456
      this.balance = '100000000000'
      this.codeExists = true
      this.sent = []
      this.simulated = []
    },
  }
  return st
})

/** SDK 17 unions: `{ type: '<arm>', <arm>: value }`, fields as properties. */
type Union = { type: string } & Record<string, unknown>

vi.mock('@stellar/stellar-sdk', async (importOriginal) => {
  const m = (await importOriginal()) as typeof import('@stellar/stellar-sdk')
  class Server {
    constructor(public url: string) {}
    async getAccount(id: string) {
      return new m.Account(id, '1')
    }
    async getAccountEntry() {
      return { balance: node.balance }
    }
    async getLedgerEntries(key: unknown) {
      if ((key as Union).type === 'contractCode') {
        return { latestLedger: 1, entries: node.codeExists ? [{}] : [] }
      }
      return {
        latestLedger: 1,
        entries: [
          {
            val: {
              type: 'contractData',
              value: {
                val: {
                  type: 'scvContractInstance',
                  value: {
                    executable: {
                      type: 'contractExecutableWasm',
                      value: {
                        toXDR: () => Buffer.from(node.readerWasm, 'hex'),
                      },
                    },
                  },
                },
              },
            },
          },
        ],
      }
    }
    async simulateTransaction(tx: { operations: { func?: unknown }[] }) {
      const func = tx.operations[0]?.func as Union | undefined
      const name =
        func?.type === 'hostFunctionTypeInvokeContract'
          ? String(
              (func.invokeContract as { functionName: unknown }).functionName
            )
          : 'deploy'
      node.simulated.push(name)
      return {
        _parsed: true,
        id: '1',
        latestLedger: 1000,
        events: [],
        minResourceFee: String(node.simFee),
        transactionData: new m.SorobanDataBuilder().setResourceFee(
          BigInt(node.simFee)
        ),
        result: {
          auth: name === 'config' || name === 'deploy' ? [] : [node.auth()],
          retval: m.xdr.ScVal.scvVoid(),
        },
      }
    }
    async sendTransaction(tx: { hash(): Uint8Array }) {
      const hash = Buffer.from(tx.hash()).toString('hex')
      node.sent.push(hash)
      if (node.send === 'throws')
        throw new Error('socket hang up from rpc-internal.example:8000')
      const status = {
        pending: 'PENDING',
        error: 'ERROR',
        try_again: 'TRY_AGAIN_LATER',
      }[node.send]
      return { status, hash }
    }
    async getTransaction() {
      if (node.get === 'throws') throw new Error('rpc down')
      if (node.get === 'not_found')
        return {
          status: 'NOT_FOUND',
          latestLedger: 900,
          latestLedgerCloseTime: String(node.closeTime),
        }
      return {
        status: node.get === 'success' ? 'SUCCESS' : 'FAILED',
        ledger: 1001,
        resultXdr: { feeCharged: node.feeCharged },
      }
    }
  }
  return { ...m, rpc: { ...m.rpc, Server } }
})

import {
  Address,
  Keypair,
  StrKey,
  nativeToScVal,
  xdr,
} from '@stellar/stellar-sdk'
import { Buffer } from 'buffer'
import schema from '../../convex/schema'
import { api, internal } from '../../convex/_generated/api'
import {
  PER_USER_PER_HOUR,
  balanceCallArgs,
  contractFn,
} from '../../convex/lib/sponsor/policy'
import { toClientError } from '../../convex/lib/sponsor/clientError'
import deploy from './fixtures/sponsor-deploy.json'

const modules = import.meta.glob('../../convex/**/*.ts')
const PASSPHRASE = 'Test SDF Network ; September 2015'
const c = (n: number) => StrKey.encodeContract(Buffer.alloc(32, n))
const TAB = c(21)
const TOKEN = c(22)
const READER = c(7)
const WASM = 'c514d35ea67eaea9bfc1fb3327854c0c06111bc1ddebd4fe217c504c1004b9e1'
const AMOUNT = BigInt(78_554_595)
const DEPLOY_PAYLOAD = {
  func: deploy.func,
  auth: deploy.auth,
  contractId: deploy.contractId,
}
type T = ReturnType<typeof convexTest>

function inv(
  fn: xdr.SorobanAuthorizedFunction,
  subs: xdr.SorobanAuthorizedInvocation[] = []
) {
  return new xdr.SorobanAuthorizedInvocation({
    function: fn,
    subInvocations: subs,
  } as never)
}
function entry(
  root: xdr.SorobanAuthorizedInvocation,
  o: { expiry?: number; signature?: xdr.ScVal } = {}
) {
  const creds = new xdr.SorobanAddressCredentials({
    address: new Address(READER).toScAddress(),
    nonce: BigInt(5),
    signatureExpirationLedger: o.expiry ?? 0,
    signature: o.signature ?? xdr.ScVal.scvVoid(),
  } as never)
  const C = xdr.SorobanCredentials as unknown as Record<
    string,
    (c: unknown) => xdr.SorobanCredentials
  >
  return new xdr.SorobanAuthorizationEntry({
    credentials: C.sorobanCredentialsAddressV2!(creds),
    rootInvocation: root,
  } as never)
}
node.auth = () => {
  const b = balanceCallArgs({
    call: 'deposit',
    tabContractId: TAB,
    tokenContractId: TOKEN,
    reader: READER,
    amount: AMOUNT,
    key: null,
    keyId: null,
  })
  return entry(
    inv(contractFn(TAB, b.function, b.args), [
      inv(
        contractFn(TOKEN, 'transfer', [
          new Address(READER).toScVal(),
          new Address(TAB).toScVal(),
          nativeToScVal(AMOUNT, { type: 'i128' }),
        ])
      ),
    ])
  )
}
const sign = (b64: string) =>
  entry(xdr.SorobanAuthorizationEntry.fromXDR(b64, 'base64').rootInvocation, {
    expiry: 1050,
    signature: xdr.ScVal.scvBytes(Buffer.alloc(64, 1)),
  }).toXDR('base64')

/** A throwaway key made for the test; its secret only reaches the stubbed env. */
let sponsorKey = Keypair.random()

function env(over: Record<string, string | undefined> = {}) {
  const base: Record<string, string | undefined> = {
    STELLAR_NETWORK: 'TESTNET',
    STELLAR_RPC_URL: 'http://127.0.0.1:9',
    SPONSOR_ENABLED: 'true',
    TAB_CONTRACT_ID: TAB,
    TOKEN_CONTRACT_ID: TOKEN,
    SPONSOR_ACCOUNT_WASM_HASH: WASM,
    SPONSOR_ACCOUNT_DEPLOYER: deploy.deployer,
    SPONSOR_PUBLIC_KEY: sponsorKey.publicKey(),
    SPONSOR_SECRET: sponsorKey.secret(),
    SPONSOR_DAILY_BUDGET_STROOPS: '20000000000',
    CORE_CONTRACT_ID: undefined,
    ...over,
  }
  for (const [k, v] of Object.entries(base)) {
    if (v === undefined) vi.stubEnv(k, '')
    else vi.stubEnv(k, v)
  }
}

async function setup(over: Record<string, string | undefined> = {}) {
  node.reset()
  node.readerWasm = WASM
  sponsorKey = Keypair.random()
  env(over)
  const t = convexTest(schema, modules)
  const now = Date.now()
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
  return { t, id, as: t.withIdentity({ subject: `${id}|s1` }) }
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

const prepare = (as: ReturnType<T['withIdentity']>, amount = AMOUNT) =>
  as.action(api.sponsor.prepare, {
    call: 'deposit',
    amount: amount.toString(),
    key: null,
    keyId: null,
  })

async function submitPrepared(as: ReturnType<T['withIdentity']>) {
  const p = await prepare(as)
  if (p.payload.kind !== 'auth') throw new Error('expected auth entries')
  const entries = p.payload.entries
  return {
    p,
    r: await outcome(
      as.action(api.sponsor.submit, {
        requestId: p.requestId,
        signedEntries: entries.map((e) => sign(e.b64)),
      })
    ),
  }
}

async function rows(t: T) {
  return t.run(async (ctx) => ctx.db.query('sponsoredCalls').collect())
}
async function spent(t: T) {
  return t.run(async (ctx) =>
    (await ctx.db.query('sponsorDays').collect()).map((d) => d.spentStroops)
  )
}

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

describe('a send whose outcome is unknown is never reported as not sent', () => {
  it('the node takes the envelope and the send throws: pending with the hash, the client is told to wait, the reconciler closes it', async () => {
    const { t, as } = await setup()
    node.send = 'throws'
    const { r } = await submitPrepared(as)
    expect(r.code).toBe('SPONSOR_PENDING')
    expect(r.message).toBe('Waiting for Stellar testnet to confirm it.')
    expect(r.message).not.toContain('rpc-internal')
    const [row] = await rows(t)
    expect(row).toMatchObject({ status: 'pending', txHash: node.sent[0] })
    expect(row!.maxTime).toBeGreaterThan(Math.floor(Date.now() / 1000))
    // The network then reports success: the fee charged is booked.
    node.get = 'success'
    await t.run(async (ctx) =>
      ctx.db.patch(row!._id, { updatedAt: Date.now() - 60_000 })
    )
    await t.action(internal.sponsor.reconcile, {})
    expect((await rows(t))[0]!.status).toBe('sent')
    expect(await spent(t)).toEqual(['123456'])
  })

  it('only the node refusing the envelope means "Nothing was sent", and releases the commitment', async () => {
    for (const send of ['error', 'try_again'] as const) {
      const { t, as } = await setup()
      node.send = send
      const { r } = await submitPrepared(as)
      expect(r.code).toBe('SPONSOR_SEND_REFUSED')
      expect(r.message).toBe('That did not go through. Nothing was sent.')
      const [row] = await rows(t)
      expect(row!.status).toBe('failed')
      expect(await spent(t)).toEqual([])
    }
  })

  it('a transaction that failed on chain is closed with its fee and told as "balance did not change"', async () => {
    const { t, as } = await setup()
    node.get = 'failed'
    const { r } = await submitPrepared(as)
    expect(r.code).toBe('SPONSOR_TX_FAILED')
    expect(r.message).toBe(
      'That did not go through. Your balance did not change.'
    )
    expect((await rows(t))[0]!.status).toBe('failed')
    expect(await spent(t)).toEqual(['123456'])
  })
})

describe('the reconciler closes by the chain, not by our clock', () => {
  async function pendingRow() {
    const s = await setup()
    node.send = 'throws'
    await submitPrepared(s.as)
    const [row] = await rows(s.t)
    await s.t.run(async (ctx) =>
      ctx.db.patch(row!._id, { updatedAt: Date.now() - 200_000 })
    )
    return { ...s, row: row! }
  }

  it('not found from a node whose clock is before the time bound: stays pending, then succeeds', async () => {
    const { t, row } = await pendingRow()
    node.get = 'not_found'
    node.closeTime = row.maxTime! - 1
    await t.action(internal.sponsor.reconcile, {})
    expect((await rows(t))[0]!.status).toBe('pending')
    node.get = 'success'
    await t.action(internal.sponsor.reconcile, {})
    expect((await rows(t))[0]!.status).toBe('sent')
    expect(await spent(t)).toEqual(['123456'])
  })

  it('not found once the node clock is past the time bound: failed with no fee', async () => {
    const { t, row } = await pendingRow()
    node.get = 'not_found'
    node.closeTime = row.maxTime! + 1
    await t.action(internal.sponsor.reconcile, {})
    expect((await rows(t))[0]).toMatchObject({
      status: 'failed',
      error: 'SPONSOR_NOT_LANDED',
    })
    expect(await spent(t)).toEqual([])
  })

  it('a failed transaction found later is closed with its fee', async () => {
    const { t } = await pendingRow()
    node.get = 'failed'
    await t.action(internal.sponsor.reconcile, {})
    expect((await rows(t))[0]!.status).toBe('failed')
    expect(await spent(t)).toEqual(['123456'])
  })

  it('a read error closes nothing', async () => {
    const { t } = await pendingRow()
    node.get = 'throws'
    await t.action(internal.sponsor.reconcile, {})
    expect((await rows(t))[0]!.status).toBe('pending')
  })

  it('runs while the sponsor is switched off, and fails a request left before signing', async () => {
    const { t, id } = await setup()
    const { requestId } = await t.mutation(internal.sponsorStore.reserve, {
      userId: id,
      call: 'deposit',
      amount: '1',
      key: null,
      keyId: null,
      passphrase: PASSPHRASE,
      dailyBudgetStroops: '20000000000',
      now: Date.now() - 10 * 60_000,
    })
    await t.mutation(internal.sponsorStore.recordPrepared, {
      requestId,
      entries: [],
      maxExpiration: 1,
      commitStroops: '2000100',
      dailyBudgetStroops: '20000000000',
      now: Date.now() - 10 * 60_000,
    })
    await t.mutation(internal.sponsorStore.claim, {
      requestId,
      userId: id,
      now: Date.now() - 10 * 60_000,
    })
    vi.stubEnv('SPONSOR_ENABLED', 'false')
    await t.action(internal.sponsor.reconcile, {})
    expect((await rows(t))[0]).toMatchObject({
      status: 'failed',
      error: 'SPONSOR_ABANDONED',
    })
  })
})

describe('the budget commits what a call may cost', () => {
  it('commits the cap, not the simulated fee', async () => {
    // Room for one cap (2,000,100) but not two, although each simulates at 80,100.
    const { t, as } = await setup({ SPONSOR_DAILY_BUDGET_STROOPS: '3000000' })
    expect((await outcome(prepare(as))).code).toBe('ALLOWED')
    expect((await outcome(prepare(as))).code).toBe('SPONSOR_BUDGET_REACHED')
    // A budget below one cap sponsors nothing.
    const small = await setup({ SPONSOR_DAILY_BUDGET_STROOPS: '100000' })
    expect((await outcome(prepare(small.as))).code).toBe(
      'SPONSOR_BUDGET_REACHED'
    )
    expect((await rows(t))[0]!.feeStroops).toBe('2000100')
  })
})

describe('deploys take the same path as balance calls', () => {
  it('commits before signing, books the fee charged, and keeps an unknown outcome pending', async () => {
    const { t } = await setup()
    node.get = 'success'
    await t.action(internal.sponsor.deployAccount, DEPLOY_PAYLOAD)
    expect((await rows(t))[0]).toMatchObject({ call: 'deploy', status: 'sent' })
    expect(await spent(t)).toEqual(['123456'])
    node.send = 'throws'
    const r = await outcome(
      t.action(internal.sponsor.deployAccount, DEPLOY_PAYLOAD)
    )
    expect(r.code).toBe('SPONSOR_PENDING')
    const pending = (await rows(t)).find((x) => x.status === 'pending')
    expect(pending).toMatchObject({ call: 'deploy' })
    expect(pending!.txHash).toMatch(/^[0-9a-f]{64}$/)
  })

  it('checks the budget before the secret is read', async () => {
    const { t } = await setup({
      SPONSOR_DAILY_BUDGET_STROOPS: '1000',
      SPONSOR_SECRET: 'not-a-secret',
    })
    const r = await outcome(
      t.action(internal.sponsor.deployAccount, DEPLOY_PAYLOAD)
    )
    expect(r.code).toBe('SPONSOR_BUDGET_REACHED')
    expect(node.sent).toEqual([])
  })
})

describe('the order of checks and what a client is told', () => {
  it('submit claims the request before the secret is read', async () => {
    const { as } = await setup({ SPONSOR_SECRET: 'not-a-secret' })
    const r = await outcome(
      as.action(api.sponsor.submit, { requestId: 'nope', signedEntries: [] })
    )
    expect(r.code).toBe('SPONSOR_UNKNOWN_REQUEST')
  })

  it('an invalid amount is refused before any limit slot or the secret', async () => {
    const { as } = await setup({ SPONSOR_SECRET: 'not-a-secret' })
    for (let i = 0; i < PER_USER_PER_HOUR + 1; i++) {
      expect((await outcome(prepare(as, BigInt(-1)))).code).toBe(
        'SPONSOR_INVALID'
      )
    }
    // No slot was spent: a valid call reaches the readiness check.
    expect((await outcome(prepare(as))).code).toBe('SPONSOR_NOT_READY')
  })

  it('an unclassified error gives a fixed sentence: wait once signed, "Nothing was sent" only before', () => {
    const e = new Error('rpc-internal.example:8000 token=abc')
    expect(toClientError(e, true).data).toEqual({
      code: 'SPONSOR_PENDING',
      message: 'Waiting for Stellar testnet to confirm it.',
    })
    expect(toClientError(e, false).data).toEqual({
      code: 'SPONSOR_FAILED',
      message: 'That did not go through. Nothing was sent.',
    })
  })

  it('configuration text never reaches a client', async () => {
    for (const over of [
      { CORE_CONTRACT_ID: 'nope' },
      { SPONSOR_ACCOUNT_WASM_HASH: undefined },
      { TAB_CONTRACT_ID: 'nope' },
    ]) {
      const { as } = await setup(over)
      const r = await outcome(prepare(as))
      expect(r.message).toBe('Sponsored calls are paused for now.')
    }
    const { as } = await setup({ SPONSOR_SECRET: 'not-a-secret' })
    const r = await outcome(prepare(as))
    expect(r.code).toBe('SPONSOR_NOT_READY')
    expect(r.message).toBe('Sponsored calls are paused for now.')
  })
})

describe('readiness fails closed', () => {
  const cases: [
    string,
    () => Record<string, string | undefined>,
    () => void,
    string,
  ][] = [
    [
      'a malformed secret',
      () => ({ SPONSOR_SECRET: 'SNOTASECRET' }),
      () => {},
      'secret_invalid',
    ],
    [
      'a secret for another address',
      () => ({ SPONSOR_PUBLIC_KEY: Keypair.random().publicKey() }),
      () => {},
      'secret_mismatch',
    ],
    [
      'a balance under the floor',
      () => ({}),
      () => {
        node.balance = '1'
      },
      'below_floor',
    ],
    [
      'account code missing on the network',
      () => ({}),
      () => {
        node.codeExists = false
      },
      'account_code_absent',
    ],
  ]

  for (const [name, over, arrange, failed] of cases) {
    it(`${name}: not ready, the public answer is false, and nothing is signed for a reader`, async () => {
      const { t, as } = await setup(over())
      arrange()
      const r = await t.action(internal.sponsor.checkReadiness, {})
      expect(r?.ready).toBe(false)
      expect(r?.failed).toContain(failed)
      expect(await t.query(api.sponsorStore.passkeyTipAvailable, {})).toBe(
        false
      )
      expect((await outcome(prepare(as))).code).toBe('SPONSOR_NOT_READY')
      expect(node.simulated.filter((f) => f !== 'config')).toEqual([])
      expect(node.sent).toEqual([])
    })
  }

  it('a missing account code hash refuses to turn on at all', async () => {
    const { t, as } = await setup({ SPONSOR_ACCOUNT_WASM_HASH: undefined })
    expect(await t.action(internal.sponsor.checkReadiness, {})).toBeNull()
    expect(await t.query(api.sponsorStore.passkeyTipAvailable, {})).toBe(false)
    expect((await outcome(prepare(as))).code).toBe('SPONSOR_CONFIG_INVALID')
    expect(node.sent).toEqual([])
  })

  it('ready: a signed simulation ran, nothing was sent, and no confirmed call yet is a warning', async () => {
    const { t } = await setup()
    const r = await t.action(internal.sponsor.checkReadiness, {})
    expect(r).toMatchObject({ ready: true, failed: [] })
    expect(r?.warnings).toEqual(['no_confirmed_call_yet'])
    expect(node.simulated).toEqual(['config'])
    expect(node.sent).toEqual([])
    expect(await t.query(api.sponsorStore.passkeyTipAvailable, {})).toBe(true)
  })

  it('a changed secret makes the next call check again', async () => {
    const { t, as } = await setup()
    await t.action(internal.sponsor.checkReadiness, {})
    vi.stubEnv('SPONSOR_SECRET', Keypair.random().secret())
    expect((await outcome(prepare(as))).code).toBe('SPONSOR_NOT_READY')
  })
})
