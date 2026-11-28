/**
 * The fee sponsor's network steps (convex/lib/sponsor/run.ts) against a fake
 * RPC server. Each test names the mutant it kills (the independent read of
 * the sponsor listed them), plus the fixes for D2 (a sent transaction is
 * never lost) and D3 (the fee cap holds on the signed envelope).
 */
import { describe, expect, it, vi } from 'vitest'
import {
  Account,
  Address,
  Keypair,
  SorobanDataBuilder,
  StrKey,
  nativeToScVal,
  xdr,
} from '@stellar/stellar-sdk'
import { Buffer } from 'buffer'
import {
  RESOURCE_FEE_CAP,
  SponsorRefusal,
  balanceCallArgs,
  contractFn,
  type BalanceCallSpec,
  type SponsorConfig,
} from '../../convex/lib/sponsor/policy'
import {
  runDeploy,
  runPrepare,
  runSubmit,
  type SponsorDeps,
  type SponsorServer,
} from '../../convex/lib/sponsor/run'
import deploy from './fixtures/sponsor-deploy.json'

const PASSPHRASE = 'Test SDF Network ; September 2015'
const contract = (seed: number) => StrKey.encodeContract(Buffer.alloc(32, seed))
const TAB = contract(1)
const TOKEN = contract(2)
const READER = contract(3)
const WASM = 'c514d35ea67eaea9bfc1fb3327854c0c06111bc1ddebd4fe217c504c1004b9e1'
const FLOOR = BigInt(1_000_000_000)

const cfg = (over: Partial<SponsorConfig> = {}): SponsorConfig => ({
  tabContractId: TAB,
  tokenContractId: TOKEN,
  dailyBudgetStroops: BigInt(20_000_000_000),
  minBalanceStroops: FLOOR,
  accountWasmHash: null,
  accountDeployer: null,
  ...over,
})

const spec: BalanceCallSpec = {
  call: 'deposit',
  tabContractId: TAB,
  tokenContractId: TOKEN,
  reader: READER,
  amount: BigInt(78_554_595),
  key: null,
  keyId: null,
}

const addr = (a: string) => new Address(a).toScVal()
const i128 = (n: bigint) => nativeToScVal(n, { type: 'i128' })

function invocation(
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

/** The auth a real simulation records for the deposit spec. */
function goodAuth() {
  const b = balanceCallArgs(spec)
  return entry(
    invocation(contractFn(TAB, b.function, b.args), [
      invocation(
        contractFn(TOKEN, 'transfer', [
          addr(READER),
          addr(TAB),
          i128(spec.amount),
        ])
      ),
    ])
  )
}

type FakeOptions = {
  balance?: bigint
  auth?: xdr.SorobanAuthorizationEntry[]
  minResourceFee?: number
  /** The resource fee in the transaction data, when it differs from minResourceFee. */
  dataResourceFee?: number
  getTransaction?: 'success' | 'failed' | 'throws' | 'not_found'
  wasmHash?: string | null
}

function fake(o: FakeOptions = {}) {
  const sponsor = Keypair.random()
  const sent: string[] = []
  const server = {
    getAccount: async (id: string) => new Account(id, '1'),
    getAccountEntry: async () => ({
      balance: (o.balance ?? FLOOR * BigInt(10)).toString(),
    }),
    getLedgerEntries: async () => ({
      latestLedger: 1,
      entries:
        o.wasmHash === null
          ? []
          : [
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
                            toXDR: () => Buffer.from(o.wasmHash ?? WASM, 'hex'),
                          },
                        },
                      },
                    },
                  },
                },
              },
            ],
    }),
    simulateTransaction: async () => ({
      _parsed: true,
      id: '1',
      latestLedger: 1000,
      events: [],
      minResourceFee: String(o.minResourceFee ?? 100_000),
      transactionData: new SorobanDataBuilder().setResourceFee(
        BigInt(o.dataResourceFee ?? o.minResourceFee ?? 100_000)
      ),
      result: { auth: o.auth ?? [goodAuth()], retval: xdr.ScVal.scvVoid() },
    }),
    sendTransaction: async (tx: { hash(): Uint8Array; fee: string }) => {
      sent.push(tx.fee)
      return { status: 'PENDING', hash: Buffer.from(tx.hash()).toString('hex') }
    },
    getTransaction: async () => {
      const mode = o.getTransaction ?? 'success'
      if (mode === 'throws') throw new Error('rpc down')
      if (mode === 'not_found') return { status: 'NOT_FOUND' }
      return {
        status: mode === 'success' ? 'SUCCESS' : 'FAILED',
        ledger: 1001,
        resultXdr: { feeCharged: 123_456 },
      }
    },
  } as unknown as SponsorServer
  const d: SponsorDeps = {
    server,
    passphrase: PASSPHRASE,
    sponsor,
    cfg: cfg(),
    confirmTimeoutMs: 50,
    pollMs: 5,
  }
  return { d, sent }
}

async function code(p: Promise<unknown>): Promise<string> {
  try {
    await p
    return 'ALLOWED'
  } catch (e) {
    if (e instanceof SponsorRefusal) return e.code
    throw e
  }
}

const signedOf = (entries: string[]) =>
  entries.map((b) => {
    const e = xdr.SorobanAuthorizationEntry.fromXDR(b, 'base64')
    return entry(e.rootInvocation, {
      expiry: 1050,
      signature: xdr.ScVal.scvBytes(Buffer.alloc(64, 1)),
    }).toXDR('base64')
  })

describe('runPrepare', () => {
  it('returns the entries to sign for a correct simulation', async () => {
    const { d } = fake()
    const p = await runPrepare(d, spec, Date.now())
    expect(p.contexts).toBe(2)
    expect(p.maxExpiration).toBe(1000 + 120)
  })

  it('mutant "runPrepare skips checkRecordedAuth": refuses auth for another call', async () => {
    const b = balanceCallArgs(spec)
    const other = entry(invocation(contractFn(TAB, 'withdraw', b.args)))
    const { d } = fake({ auth: [other] })
    expect(await code(runPrepare(d, spec, Date.now()))).toBe(
      'SPONSOR_AUTH_REFUSED'
    )
  })

  it('mutant "floor check removed" (prepare): refuses below the floor, allows at the floor', async () => {
    expect(
      await code(
        runPrepare(fake({ balance: FLOOR - BigInt(1) }).d, spec, Date.now())
      )
    ).toBe('SPONSOR_LOW_BALANCE')
    expect(
      await code(runPrepare(fake({ balance: FLOOR }).d, spec, Date.now()))
    ).toBe('ALLOWED')
  })

  it('refuses a fee over the cap at prepare', async () => {
    const { d } = fake({ minResourceFee: Number(RESOURCE_FEE_CAP.deposit) + 1 })
    expect(await code(runPrepare(d, spec, Date.now()))).toBe(
      'SPONSOR_FEE_OVER_CAP'
    )
  })

  it('refuses a reader account that is not the allowlisted code, or not deployed', async () => {
    const other = fake({ wasmHash: 'ff'.repeat(32) })
    other.d.cfg = cfg({ accountWasmHash: WASM })
    expect(await code(runPrepare(other.d, spec, Date.now()))).toBe(
      'SPONSOR_READER_NOT_ALLOWED'
    )
    const none = fake({ wasmHash: null })
    none.d.cfg = cfg({ accountWasmHash: WASM })
    expect(await code(runPrepare(none.d, spec, Date.now()))).toBe(
      'SPONSOR_READER_NOT_ALLOWED'
    )
    const ok = fake()
    ok.d.cfg = cfg({ accountWasmHash: WASM })
    expect(await code(runPrepare(ok.d, spec, Date.now()))).toBe('ALLOWED')
  })
})

describe('runSubmit', () => {
  async function prepared(o: FakeOptions = {}) {
    const f = fake(o)
    const p = await runPrepare(fake().d, spec, Date.now())
    return { ...f, p }
  }

  it('sends a correctly signed call and reports the fee', async () => {
    const { d, p } = await prepared()
    const onSent = vi.fn()
    const r = await runSubmit(
      d,
      spec,
      p.entries,
      signedOf(p.entries),
      p.maxExpiration,
      { onSent }
    )
    expect(r.fee).toBe('123456')
    expect(onSent).toHaveBeenCalledOnce()
  })

  it('mutant "runSubmit compares the signed entries with themselves": refuses signatures for another call', async () => {
    const { d, p } = await prepared()
    const b = balanceCallArgs(spec)
    const forged = entry(invocation(contractFn(TAB, 'withdraw', b.args)), {
      expiry: 1050,
      signature: xdr.ScVal.scvBytes(Buffer.alloc(64, 1)),
    })
    expect(
      await code(
        runSubmit(d, spec, p.entries, [forged.toXDR('base64')], p.maxExpiration)
      )
    ).toBe('SPONSOR_SIGNED_MISMATCH')
  })

  it('mutant "fee cap removed at submit": refuses a re-simulation over the cap', async () => {
    const { d, p, sent } = await prepared({
      minResourceFee: Number(RESOURCE_FEE_CAP.deposit) + 1,
    })
    expect(
      await code(
        runSubmit(d, spec, p.entries, signedOf(p.entries), p.maxExpiration)
      )
    ).toBe('SPONSOR_FEE_OVER_CAP')
    expect(sent).toEqual([])
  })

  it('D3: refuses an envelope whose transaction data asks more than the cap, before signing', async () => {
    const { d, p, sent } = await prepared({
      minResourceFee: 1000,
      dataResourceFee: 900_000_000,
    })
    expect(
      await code(
        runSubmit(d, spec, p.entries, signedOf(p.entries), p.maxExpiration)
      )
    ).toBe('SPONSOR_FEE_OVER_CAP')
    expect(sent).toEqual([])
  })

  it('mutant "floor check removed" (submit): refuses below the floor', async () => {
    const { d, p } = await prepared({ balance: FLOOR - BigInt(1) })
    expect(
      await code(
        runSubmit(d, spec, p.entries, signedOf(p.entries), p.maxExpiration)
      )
    ).toBe('SPONSOR_LOW_BALANCE')
  })

  it('D2: a read error after the send keeps the hash and ends pending, never failed', async () => {
    {
      const { d, p } = await prepared({ getTransaction: 'throws' })
      const onSent = vi.fn()
      const onFee = vi.fn()
      expect(
        await code(
          runSubmit(d, spec, p.entries, signedOf(p.entries), p.maxExpiration, {
            onSent,
            onFee,
          })
        )
      ).toBe('SPONSOR_PENDING')
      expect(onSent).toHaveBeenCalledOnce()
      expect(onSent.mock.calls[0]![0]).toMatch(/^[0-9a-f]{64}$/)
      expect(onFee).not.toHaveBeenCalled()
    }
  })

  it('D2: no answer before the deadline is pending, with the hash stored', async () => {
    {
      const { d, p } = await prepared({ getTransaction: 'not_found' })
      const onSent = vi.fn()
      expect(
        await code(
          runSubmit(d, spec, p.entries, signedOf(p.entries), p.maxExpiration, {
            onSent,
          })
        )
      ).toBe('SPONSOR_PENDING')
      expect(onSent).toHaveBeenCalledOnce()
    }
  })

  it('a failed transaction reports its fee', async () => {
    const { d, p } = await prepared({ getTransaction: 'failed' })
    const onFee = vi.fn()
    expect(
      await code(
        runSubmit(d, spec, p.entries, signedOf(p.entries), p.maxExpiration, {
          onFee,
        })
      )
    ).toBe('SPONSOR_TX_FAILED')
    expect(onFee).toHaveBeenCalledWith('123456')
  })
})

describe('runDeploy', () => {
  const payload = {
    func: deploy.func,
    auth: deploy.auth,
    contractId: deploy.contractId,
  }
  const withDeploy = (o: FakeOptions = {}) => {
    const f = fake(o)
    f.d.cfg = cfg({ accountWasmHash: WASM, accountDeployer: deploy.deployer })
    return f
  }

  it('deploys the allowlisted account', async () => {
    expect(await code(runDeploy(withDeploy().d, payload))).toBe('ALLOWED')
  })

  it('mutant "floor check removed" (deploy): refuses below the floor', async () => {
    expect(
      await code(
        runDeploy(withDeploy({ balance: FLOOR - BigInt(1) }).d, payload)
      )
    ).toBe('SPONSOR_LOW_BALANCE')
  })

  it('refuses a deploy over its cap, on the envelope too', async () => {
    expect(
      await code(runDeploy(withDeploy({ minResourceFee: 400_001 }).d, payload))
    ).toBe('SPONSOR_FEE_OVER_CAP')
    expect(
      await code(
        runDeploy(
          withDeploy({ minResourceFee: 1000, dataResourceFee: 900_000_000 }).d,
          payload
        )
      )
    ).toBe('SPONSOR_FEE_OVER_CAP')
  })

  it('refuses when account creation is not configured', async () => {
    expect(await code(runDeploy(fake().d, payload))).toBe(
      'SPONSOR_DEPLOY_DISABLED'
    )
  })
})
