/**
 * The fee sponsor's network steps (convex/lib/sponsor/run.ts) against a fake
 * RPC server. Each test names the rule it proves: the checks at prepare,
 * submit and deploy, that a transaction's record exists before it is sent, that only the node's refusal
 * means "not sent", that the fee cap holds on the signed envelope, and when a
 * missing transaction is known not to have landed.
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
  knownNotLanded,
  lookupSent,
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
  accountWasmHash: WASM,
  accountDeployer: null,
  accountVerifier: null,
  publicKey: Keypair.random().publicKey(),
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
  /** What the node answers to the send. */
  send?: 'pending' | 'duplicate' | 'error' | 'try_again' | 'throws'
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
      const hash = Buffer.from(tx.hash()).toString('hex')
      const mode = o.send ?? 'pending'
      if (mode === 'throws')
        throw new Error('socket hang up after the node took it')
      const status = {
        pending: 'PENDING',
        duplicate: 'DUPLICATE',
        error: 'ERROR',
        try_again: 'TRY_AGAIN_LATER',
      }[mode]
      return { status, hash }
    },
    getTransaction: async () => {
      const mode = o.getTransaction ?? 'success'
      if (mode === 'throws') throw new Error('rpc down')
      if (mode === 'not_found')
        return {
          status: 'NOT_FOUND',
          latestLedgerCloseTime: '1700000000',
          oldestLedgerCloseTime: '1699000000',
        }
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

  it('prepare refuses recorded auth for another call', async () => {
    const b = balanceCallArgs(spec)
    const other = entry(invocation(contractFn(TAB, 'withdraw', b.args)))
    const { d } = fake({ auth: [other] })
    expect(await code(runPrepare(d, spec, Date.now()))).toBe(
      'SPONSOR_AUTH_REFUSED'
    )
  })

  it('prepare refuses below the balance floor and allows at it', async () => {
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
    other.d.cfg = cfg()
    expect(await code(runPrepare(other.d, spec, Date.now()))).toBe(
      'SPONSOR_READER_NOT_ALLOWED'
    )
    const none = fake({ wasmHash: null })
    none.d.cfg = cfg()
    expect(await code(runPrepare(none.d, spec, Date.now()))).toBe(
      'SPONSOR_READER_NOT_ALLOWED'
    )
    const ok = fake()
    expect(await code(runPrepare(ok.d, spec, Date.now()))).toBe('ALLOWED')
  })

  it('refuses every reader when no account code is allowlisted (fails closed)', async () => {
    const { d } = fake()
    d.cfg = cfg({ accountWasmHash: null })
    expect(await code(runPrepare(d, spec, Date.now()))).toBe(
      'SPONSOR_CONFIG_INVALID'
    )
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
    const onSigned = vi.fn()
    const r = await runSubmit(
      d,
      spec,
      p.entries,
      signedOf(p.entries),
      p.maxExpiration,
      { onSigned }
    )
    expect(r.fee).toBe('123456')
    expect(onSigned).toHaveBeenCalledOnce()
  })

  it('submit refuses signatures for another call than the prepared one', async () => {
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

  it('submit refuses a re-simulation over the fee cap', async () => {
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

  it('refuses an envelope whose transaction data asks more than the cap, before signing', async () => {
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

  it('submit refuses below the balance floor', async () => {
    const { d, p } = await prepared({ balance: FLOOR - BigInt(1) })
    expect(
      await code(
        runSubmit(d, spec, p.entries, signedOf(p.entries), p.maxExpiration)
      )
    ).toBe('SPONSOR_LOW_BALANCE')
  })

  it('a read error after the send keeps the hash and ends pending, never failed', async () => {
    {
      const { d, p } = await prepared({ getTransaction: 'throws' })
      const onSigned = vi.fn()
      const onFee = vi.fn()
      expect(
        await code(
          runSubmit(d, spec, p.entries, signedOf(p.entries), p.maxExpiration, {
            onSigned,
            onFee,
          })
        )
      ).toBe('SPONSOR_PENDING')
      expect(onSigned).toHaveBeenCalledOnce()
      expect(onSigned.mock.calls[0]![0]).toMatch(/^[0-9a-f]{64}$/)
      expect(onFee).not.toHaveBeenCalled()
    }
  })

  it('no answer before the deadline is pending, with the hash stored', async () => {
    {
      const { d, p } = await prepared({ getTransaction: 'not_found' })
      const onSigned = vi.fn()
      expect(
        await code(
          runSubmit(d, spec, p.entries, signedOf(p.entries), p.maxExpiration, {
            onSigned,
          })
        )
      ).toBe('SPONSOR_PENDING')
      expect(onSigned).toHaveBeenCalledOnce()
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

  it('records the hash, fee and time bound before the envelope reaches the node', async () => {
    const { d, p, sent } = await prepared()
    const order: string[] = []
    const onSigned = vi.fn((hash: string, fee: string, maxTime: number) => {
      order.push(`signed:${sent.length}`)
      expect(hash).toMatch(/^[0-9a-f]{64}$/)
      expect(Number(fee)).toBeGreaterThan(0)
      expect(maxTime).toBeGreaterThan(Math.floor(Date.now() / 1000))
    })
    await runSubmit(d, spec, p.entries, signedOf(p.entries), p.maxExpiration, {
      onSigned,
    })
    // When the record was written, nothing had been handed to the node.
    expect(order).toEqual(['signed:0'])
    expect(sent).toHaveLength(1)
  })

  it('sends nothing when the record cannot be written', async () => {
    const { d, p, sent } = await prepared()
    const onSigned = vi.fn(async () => {
      throw new Error('database unavailable')
    })
    await expect(
      runSubmit(d, spec, p.entries, signedOf(p.entries), p.maxExpiration, {
        onSigned,
      })
    ).rejects.toThrow('database unavailable')
    expect(sent).toEqual([])
  })

  it('a send that throws after the node may have taken it is pending, not refused', async () => {
    const { d, p, sent } = await prepared({ send: 'throws' })
    const onSigned = vi.fn()
    expect(
      await code(
        runSubmit(d, spec, p.entries, signedOf(p.entries), p.maxExpiration, {
          onSigned,
        })
      )
    ).toBe('SPONSOR_PENDING')
    expect(onSigned).toHaveBeenCalledOnce()
    expect(sent).toHaveLength(1)
  })

  it('only ERROR and TRY_AGAIN_LATER mean the node did not take it; DUPLICATE goes on', async () => {
    for (const send of ['error', 'try_again'] as const) {
      const { d, p } = await prepared({ send })
      expect(
        await code(
          runSubmit(d, spec, p.entries, signedOf(p.entries), p.maxExpiration)
        )
      ).toBe('SPONSOR_SEND_REFUSED')
    }
    const { d, p } = await prepared({ send: 'duplicate' })
    expect(
      await code(
        runSubmit(d, spec, p.entries, signedOf(p.entries), p.maxExpiration)
      )
    ).toBe('ALLOWED')
  })
})

describe('when a missing transaction is known not to have landed', () => {
  it('lookupSent reports the node history window with "not found"', async () => {
    const { d } = fake({ getTransaction: 'not_found' })
    expect(await lookupSent(d.server, 'ab'.repeat(32))).toEqual({
      status: 'NOT_FOUND',
      latestLedgerCloseTime: 1_700_000_000,
      oldestLedgerCloseTime: 1_699_000_000,
    })
  })

  it('only when the node history covers the signing time through past the time bound', () => {
    const tx = { signedAt: 1000, maxTime: 1120 }
    const node = (oldest: number, latest: number) => ({
      oldestLedgerCloseTime: oldest,
      latestLedgerCloseTime: latest,
    })
    expect(knownNotLanded(node(900, 1121), tx)).toBe(true)
    expect(knownNotLanded(node(1000, 1121), tx)).toBe(true)
    // The node has not reached past the time bound.
    expect(knownNotLanded(node(900, 1120), tx)).toBe(false)
    // Its history starts after the signing time: it may have missed it.
    expect(knownNotLanded(node(1001, 5000), tx)).toBe(false)
    expect(knownNotLanded(node(1420, 5000), tx)).toBe(false)
    // No recorded bound or signing time: never.
    expect(knownNotLanded(node(0, 5000), { signedAt: 0, maxTime: 1120 })).toBe(
      false
    )
    expect(knownNotLanded(node(0, 5000), { signedAt: 1000, maxTime: 0 })).toBe(
      false
    )
  })
})

describe('runDeploy', () => {
  const payload = {
    func: deploy.func,
    auth: deploy.auth,
    contractId: deploy.contractId,
    signerKey: deploy.signerKey,
  }
  const withDeploy = (o: FakeOptions = {}) => {
    const f = fake(o)
    f.d.cfg = cfg({
      accountWasmHash: WASM,
      accountDeployer: deploy.deployer,
      accountVerifier: deploy.verifier,
    })
    return f
  }

  it('deploys the allowlisted account', async () => {
    expect(await code(runDeploy(withDeploy().d, payload))).toBe('ALLOWED')
  })

  it('refuses before signing an account not born with the given passkey', async () => {
    const f = withDeploy()
    f.d.cfg = { ...f.d.cfg, accountVerifier: contract(9) }
    expect(await code(runDeploy(f.d, payload))).toBe('SPONSOR_DEPLOY_REFUSED')
    expect(f.sent).toEqual([])
  })

  it('deploy refuses below the balance floor', async () => {
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
    const noVerifier = withDeploy()
    noVerifier.d.cfg = { ...noVerifier.d.cfg, accountVerifier: null }
    expect(await code(runDeploy(noVerifier.d, payload))).toBe(
      'SPONSOR_DEPLOY_DISABLED'
    )
  })
})
