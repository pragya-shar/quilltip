/**
 * The fee sponsor's policy (convex/lib/sponsor/policy.ts): every refusal in
 * the threat list that the pure checks own. Auth entries are built the way
 * testnet's simulation returns them on protocol 30
 * (`sorobanCredentialsAddressV2`); the deploy payload is a real one from
 * `smart-account-kit` 0.10.0 (public data: the host function, the shared
 * deployer's signed auth entry, and the verifier and signer key its
 * constructor installs).
 */
import { describe, expect, it } from 'vitest'
import {
  Address,
  Keypair,
  StrKey,
  nativeToScVal,
  xdr,
} from '@stellar/stellar-sdk'
import { Buffer } from 'buffer'
import {
  RESOURCE_FEE_CAP,
  SponsorRefusal,
  balanceCallArgs,
  checkDeployPayload,
  checkRecordedAuth,
  checkResourceFee,
  checkSignedMatchesPrepared,
  checkSpec,
  contractFn,
  commitStroops,
  sponsorConfig,
  sponsorSecret,
  type BalanceCallSpec,
} from '../../convex/lib/sponsor/policy'
import deploy from './fixtures/sponsor-deploy.json'

const TESTNET = 'Test SDF Network ; September 2015'
const contract = (seed: number) => StrKey.encodeContract(Buffer.alloc(32, seed))
const TAB = contract(1)
const TOKEN = contract(2)
const READER = contract(3)
const OTHER = contract(4)
const SPONSOR = Keypair.random().publicKey()
const DEVICE = 'ab'.repeat(32)

const spec = (over: Partial<BalanceCallSpec> = {}): BalanceCallSpec => ({
  call: 'open_session',
  tabContractId: TAB,
  tokenContractId: TOKEN,
  reader: READER,
  amount: BigInt(392_772_977),
  key: {
    publicKey: DEVICE,
    validUntil: 6_100_000,
    spendLimit: BigInt(392_772_977),
  },
  keyId: null,
  ...over,
})

const addr = (a: string) => new Address(a).toScVal()
const i128 = (n: bigint) => nativeToScVal(n, { type: 'i128' })

function invocation(
  fn: xdr.SorobanAuthorizedFunction,
  subs: xdr.SorobanAuthorizedInvocation[] = []
): xdr.SorobanAuthorizedInvocation {
  return new xdr.SorobanAuthorizedInvocation({
    function: fn,
    subInvocations: subs,
  } as never)
}

function entry(args: {
  address?: string
  root: xdr.SorobanAuthorizedInvocation
  nonce?: bigint
  expiry?: number
  signature?: xdr.ScVal
  v1?: boolean
}): xdr.SorobanAuthorizationEntry {
  const creds = new xdr.SorobanAddressCredentials({
    address: new Address(args.address ?? READER).toScAddress(),
    nonce: args.nonce ?? BigInt(77),
    signatureExpirationLedger: args.expiry ?? 0,
    signature: args.signature ?? xdr.ScVal.scvVoid(),
  } as never)
  const C = xdr.SorobanCredentials as unknown as Record<
    string,
    (c: unknown) => xdr.SorobanCredentials
  >
  return new xdr.SorobanAuthorizationEntry({
    credentials: args.v1
      ? C.sorobanCredentialsAddress!(creds)
      : C.sorobanCredentialsAddressV2!(creds),
    rootInvocation: args.root,
  } as never)
}

/** What testnet's recording simulation returns for a spec. */
function recorded(s: BalanceCallSpec): xdr.SorobanAuthorizationEntry {
  const built = balanceCallArgs(s)
  const subs =
    s.amount > BigInt(0)
      ? [
          invocation(
            contractFn(TOKEN, 'transfer', [
              addr(s.reader),
              addr(TAB),
              i128(s.amount),
            ])
          ),
        ]
      : []
  return entry({
    root: invocation(
      contractFn(built.contract, built.function, built.args),
      subs
    ),
  })
}

/** The refusal's message, to tell refusals with one code apart. */
const reason = (fn: () => unknown) => {
  try {
    fn()
  } catch (e) {
    if (e instanceof SponsorRefusal) return e.message
    throw e
  }
  return 'ALLOWED'
}

const code = (fn: () => unknown) => {
  try {
    fn()
  } catch (e) {
    if (e instanceof SponsorRefusal) return e.code
    throw e
  }
  return 'ALLOWED'
}

describe('balance calls the sponsor builds', () => {
  it('accepts the four allowlisted calls and counts contexts', () => {
    expect(checkRecordedAuth([recorded(spec())], spec())).toEqual({
      contexts: 2,
    })
    const dep = spec({ call: 'deposit', key: null })
    expect(checkRecordedAuth([recorded(dep)], dep)).toEqual({ contexts: 2 })
    const reg = spec({ call: 'register_key', amount: BigInt(0) })
    expect(checkRecordedAuth([recorded(reg)], reg)).toEqual({ contexts: 1 })
    const rev = spec({
      call: 'revoke_key',
      amount: BigInt(0),
      key: null,
      keyId: 3,
    })
    expect(checkRecordedAuth([recorded(rev)], rev)).toEqual({ contexts: 1 })
    const renew = spec({ amount: BigInt(0) })
    expect(checkRecordedAuth([recorded(renew)], renew)).toEqual({ contexts: 1 })
  })

  it('accepts version 1 address credentials too', () => {
    const s = spec({
      call: 'revoke_key',
      amount: BigInt(0),
      key: null,
      keyId: 0,
    })
    const built = balanceCallArgs(s)
    const e = entry({
      v1: true,
      root: invocation(contractFn(TAB, built.function, built.args)),
    })
    expect(code(() => checkRecordedAuth([e], s))).toBe('ALLOWED')
  })

  it('refuses a call that is not in the list', () => {
    expect(code(() => checkSpec(spec({ call: 'withdraw' as never })))).toBe(
      'SPONSOR_CALL_NOT_ALLOWED'
    )
  })

  it('refuses a wallet (G) reader: a wallet pays its own fee', () => {
    expect(
      code(() => checkSpec(spec({ reader: Keypair.random().publicKey() })))
    ).toBe('SPONSOR_READER_NOT_PASSKEY')
  })

  it('refuses malformed specs', () => {
    expect(code(() => checkSpec(spec({ key: null })))).toBe('SPONSOR_INVALID')
    expect(
      code(() =>
        checkSpec(
          spec({
            key: {
              publicKey: '00'.repeat(32),
              validUntil: 1,
              spendLimit: BigInt(1),
            },
          })
        )
      )
    ).toBe('SPONSOR_INVALID')
    expect(
      code(() =>
        checkSpec(
          spec({
            key: { publicKey: DEVICE, validUntil: 1, spendLimit: BigInt(0) },
          })
        )
      )
    ).toBe('SPONSOR_INVALID')
    expect(code(() => checkSpec(spec({ amount: -BigInt(1) })))).toBe(
      'SPONSOR_INVALID'
    )
    expect(
      code(() =>
        checkSpec(spec({ call: 'deposit', key: null, amount: BigInt(0) }))
      )
    ).toBe('SPONSOR_INVALID')
    expect(
      code(() => checkSpec(spec({ call: 'register_key', amount: BigInt(5) })))
    ).toBe('SPONSOR_INVALID')
    expect(
      code(() =>
        checkSpec(
          spec({
            call: 'revoke_key',
            amount: BigInt(0),
            key: null,
            keyId: null,
          })
        )
      )
    ).toBe('SPONSOR_INVALID')
  })

  it('accepts a cap of exactly one tip (a "just this tip" approval)', () => {
    const s = spec({
      key: {
        publicKey: DEVICE,
        validUntil: 6_100_000,
        spendLimit: BigInt(78_554_595),
      },
    })
    expect(code(() => checkRecordedAuth([recorded(s)], s))).toBe('ALLOWED')
  })
})

describe('recorded auth must be exactly the built call', () => {
  const s = spec()
  const built = balanceCallArgs(s)
  const transfer = (to: string, amount: bigint, token = TOKEN) =>
    invocation(
      contractFn(token, 'transfer', [addr(READER), addr(to), i128(amount)])
    )

  it('refuses more or fewer than one entry', () => {
    expect(code(() => checkRecordedAuth([], s))).toBe('SPONSOR_AUTH_REFUSED')
    expect(code(() => checkRecordedAuth([recorded(s), recorded(s)], s))).toBe(
      'SPONSOR_AUTH_REFUSED'
    )
  })

  it('refuses an entry for another address, or for the sponsor', () => {
    const root = recorded(s).rootInvocation
    expect(
      code(() => checkRecordedAuth([entry({ address: OTHER, root })], s))
    ).toBe('SPONSOR_AUTH_REFUSED')
    expect(
      code(() => checkRecordedAuth([entry({ address: SPONSOR, root })], s))
    ).toBe('SPONSOR_AUTH_REFUSED')
  })

  it('refuses source-account credentials', () => {
    const e = new xdr.SorobanAuthorizationEntry({
      credentials: xdr.SorobanCredentials.sorobanCredentialsSourceAccount(),
      rootInvocation: recorded(s).rootInvocation,
    } as never)
    expect(code(() => checkRecordedAuth([e], s))).toBe('SPONSOR_AUTH_REFUSED')
  })

  it('refuses another contract, another function or other arguments', () => {
    const sub = [transfer(TAB, s.amount)]
    for (const root of [
      invocation(contractFn(OTHER, built.function, built.args), sub),
      invocation(contractFn(TAB, 'withdraw', built.args), sub),
      invocation(
        contractFn(TAB, built.function, [
          ...built.args.slice(0, 4),
          i128(BigInt(999_999_999_999)),
        ]),
        sub
      ),
    ]) {
      expect(code(() => checkRecordedAuth([entry({ root })], s))).toBe(
        'SPONSOR_AUTH_REFUSED'
      )
    }
  })

  it('refuses a transfer to someone else, of another amount, of another token, or extra calls', () => {
    const fn = contractFn(TAB, built.function, built.args)
    for (const subs of [
      [transfer(OTHER, s.amount)],
      [transfer(TAB, s.amount + BigInt(1))],
      [transfer(TAB, s.amount, OTHER)],
      [transfer(TAB, s.amount), transfer(TAB, s.amount)],
      [
        invocation(
          contractFn(TOKEN, 'transfer', [
            addr(READER),
            addr(TAB),
            i128(s.amount),
          ]),
          [transfer(OTHER, BigInt(1))]
        ),
      ],
      [],
    ]) {
      expect(
        code(() =>
          checkRecordedAuth([entry({ root: invocation(fn, subs) })], s)
        )
      ).toBe('SPONSOR_AUTH_REFUSED')
    }
  })

  it('refuses a nested call when no money moves', () => {
    const r = spec({ call: 'register_key', amount: BigInt(0) })
    const b = balanceCallArgs(r)
    const root = invocation(contractFn(TAB, b.function, b.args), [
      transfer(TAB, BigInt(1)),
    ])
    expect(code(() => checkRecordedAuth([entry({ root })], r))).toBe(
      'SPONSOR_AUTH_REFUSED'
    )
  })
})

describe('signed entries must be the prepared ones', () => {
  const s = spec()
  const prepared = recorded(s)
  const p = [prepared.toXDR('base64')]
  const sig = xdr.ScVal.scvBytes(Buffer.alloc(64, 9))
  const signedLike = (over: Partial<Parameters<typeof entry>[0]>) =>
    entry({
      root: prepared.rootInvocation,
      expiry: 1_000,
      signature: sig,
      ...over,
    })

  it('accepts the same entry with a signature and an expiry in range', () => {
    expect(
      code(() =>
        checkSignedMatchesPrepared(p, [signedLike({}).toXDR('base64')], 1_000)
      )
    ).toBe('ALLOWED')
  })

  it('refuses a changed tree, nonce, address, credential version or count', () => {
    const other = recorded(
      spec({
        amount: BigInt(1),
        key: {
          publicKey: DEVICE,
          validUntil: 6_100_000,
          spendLimit: BigInt(1),
        },
      })
    )
    for (const bad of [
      signedLike({ root: other.rootInvocation }),
      signedLike({ nonce: BigInt(78) }),
      signedLike({ address: OTHER }),
      signedLike({ v1: true }),
    ]) {
      expect(
        code(() => checkSignedMatchesPrepared(p, [bad.toXDR('base64')], 1_000))
      ).toBe('SPONSOR_SIGNED_MISMATCH')
    }
    expect(code(() => checkSignedMatchesPrepared(p, [], 1_000))).toBe(
      'SPONSOR_SIGNED_MISMATCH'
    )
    expect(code(() => checkSignedMatchesPrepared(p, ['not xdr'], 1_000))).toBe(
      'SPONSOR_SIGNED_MISMATCH'
    )
  })

  it('refuses an expiry past the limit or missing', () => {
    expect(
      code(() =>
        checkSignedMatchesPrepared(
          p,
          [signedLike({ expiry: 1_001 }).toXDR('base64')],
          1_000
        )
      )
    ).toBe('SPONSOR_SIGNED_MISMATCH')
    expect(
      code(() =>
        checkSignedMatchesPrepared(
          p,
          [signedLike({ expiry: 0 }).toXDR('base64')],
          1_000
        )
      )
    ).toBe('SPONSOR_SIGNED_MISMATCH')
  })
})

describe('fee caps', () => {
  it('allows up to the cap and refuses above it', () => {
    expect(
      code(() =>
        checkResourceFee('open_session', RESOURCE_FEE_CAP.open_session)
      )
    ).toBe('ALLOWED')
    expect(
      code(() =>
        checkResourceFee(
          'open_session',
          RESOURCE_FEE_CAP.open_session + BigInt(1)
        )
      )
    ).toBe('SPONSOR_FEE_OVER_CAP')
    expect(code(() => checkResourceFee('deposit', BigInt(2_000_001)))).toBe(
      'SPONSOR_FEE_OVER_CAP'
    )
    expect(code(() => checkResourceFee('revoke_key', BigInt(600_001)))).toBe(
      'SPONSOR_FEE_OVER_CAP'
    )
    expect(code(() => checkResourceFee('deploy', BigInt(400_001)))).toBe(
      'SPONSOR_FEE_OVER_CAP'
    )
  })
})

describe('account birth', () => {
  const ok = {
    func: deploy.func,
    auth: deploy.auth,
    wasmHash:
      'c514d35ea67eaea9bfc1fb3327854c0c06111bc1ddebd4fe217c504c1004b9e1',
    deployer: deploy.deployer,
    verifier: deploy.verifier,
    signerKey: deploy.signerKey,
    expectedContractId: deploy.contractId,
    passphrase: TESTNET,
  }

  /**
   * The kit payload with other constructor arguments, and the deployer's
   * entry rewritten to authorize exactly that creation, so the constructor
   * is the only thing that differs.
   */
  function withConstructor(args: xdr.ScVal[]): {
    func: string
    auth: string[]
  } {
    const hf = xdr.HostFunction.fromXDR(deploy.func, 'base64') as unknown as {
      value: xdr.CreateContractArgsV2
    }
    const create = new xdr.CreateContractArgsV2({
      contractIdPreimage: hf.value.contractIdPreimage,
      executable: hf.value.executable,
      constructorArgs: args,
    } as never)
    const signed = xdr.SorobanAuthorizationEntry.fromXDR(
      deploy.auth[0]!,
      'base64'
    )
    const auth = new xdr.SorobanAuthorizationEntry({
      credentials: signed.credentials,
      rootInvocation: invocation(
        xdr.SorobanAuthorizedFunction.sorobanAuthorizedFunctionTypeCreateContractV2HostFn(
          create
        )
      ),
    } as never)
    return {
      func: xdr.HostFunction.hostFunctionTypeCreateContractV2(create).toXDR(
        'base64'
      ),
      auth: [auth.toXDR('base64')],
    }
  }

  const KEY = Buffer.from(deploy.signerKey, 'hex')
  const signer = (verifier: string, key: Buffer, kind = 'External') =>
    xdr.ScVal.scvVec([
      xdr.ScVal.scvSymbol(kind),
      new Address(verifier).toScVal(),
      xdr.ScVal.scvBytes(key),
    ])
  const NOT_THE_PASSKEY =
    'The account is not born with exactly the verified passkey as signer.'

  it('accepts the kit payload from the allowlisted deployer and WASM', () => {
    expect(code(() => checkDeployPayload(ok))).toBe('ALLOWED')
    expect(
      code(() =>
        checkDeployPayload({
          ...ok,
          ...withConstructor([
            xdr.ScVal.scvVec([signer(deploy.verifier, KEY)]),
            xdr.ScVal.scvMap([]),
          ]),
        })
      )
    ).toBe('ALLOWED')
  })

  it('refuses an account born with another verifier or another key', () => {
    // The configured verifier or the verified key differs from the payload's.
    expect(reason(() => checkDeployPayload({ ...ok, verifier: OTHER }))).toBe(
      NOT_THE_PASSKEY
    )
    const flipped = Buffer.from(KEY)
    flipped[10] = flipped[10]! ^ 1
    expect(
      reason(() =>
        checkDeployPayload({ ...ok, signerKey: flipped.toString('hex') })
      )
    ).toBe(NOT_THE_PASSKEY)
    // The payload's signer differs from the configured verifier or the key.
    expect(
      reason(() =>
        checkDeployPayload({
          ...ok,
          ...withConstructor([
            xdr.ScVal.scvVec([signer(OTHER, KEY)]),
            xdr.ScVal.scvMap([]),
          ]),
        })
      )
    ).toBe(NOT_THE_PASSKEY)
    expect(
      reason(() =>
        checkDeployPayload({
          ...ok,
          ...withConstructor([
            xdr.ScVal.scvVec([signer(deploy.verifier, flipped)]),
            xdr.ScVal.scvMap([]),
          ]),
        })
      )
    ).toBe(NOT_THE_PASSKEY)
  })

  it('refuses a second signer, another signer kind, a policy or other arguments', () => {
    const one = signer(deploy.verifier, KEY)
    const cases: xdr.ScVal[][] = [
      // A second signer beside the passkey: someone else could sign too.
      [
        xdr.ScVal.scvVec([one, signer(OTHER, Buffer.alloc(65, 4))]),
        xdr.ScVal.scvMap([]),
      ],
      // A delegated signer in place of the passkey.
      [
        xdr.ScVal.scvVec([signer(deploy.verifier, KEY, 'Delegated')]),
        xdr.ScVal.scvMap([]),
      ],
      // No signer at all.
      [xdr.ScVal.scvVec([]), xdr.ScVal.scvMap([])],
      // A policy installed at birth.
      [
        xdr.ScVal.scvVec([one]),
        xdr.ScVal.scvMap([
          new xdr.ScMapEntry({
            key: new Address(OTHER).toScVal(),
            val: xdr.ScVal.scvVoid(),
          }),
        ]),
      ],
      // Missing or extra arguments.
      [xdr.ScVal.scvVec([one])],
      [xdr.ScVal.scvVec([one]), xdr.ScVal.scvMap([]), xdr.ScVal.scvVoid()],
    ]
    for (const args of cases) {
      expect(
        reason(() => checkDeployPayload({ ...ok, ...withConstructor(args) }))
      ).toBe(NOT_THE_PASSKEY)
    }
  })

  it('refuses a signer key that is not a passkey key', () => {
    for (const bad of [
      '',
      'zz'.repeat(81),
      deploy.signerKey.slice(1),
      deploy.signerKey.toUpperCase(),
      // Compressed (0x02) in place of uncompressed (0x04).
      '02' + deploy.signerKey.slice(2),
      // A credential id shorter than 16 bytes.
      deploy.signerKey.slice(0, (65 + 15) * 2),
      '04' + 'ab'.repeat(64 + 1024),
    ]) {
      expect(reason(() => checkDeployPayload({ ...ok, signerKey: bad }))).toBe(
        'The signer key is not a passkey key.'
      )
    }
  })

  it('refuses another WASM, deployer, account address or network', () => {
    expect(
      code(() => checkDeployPayload({ ...ok, wasmHash: 'ff'.repeat(32) }))
    ).toBe('SPONSOR_DEPLOY_REFUSED')
    expect(
      code(() =>
        checkDeployPayload({ ...ok, deployer: Keypair.random().publicKey() })
      )
    ).toBe('SPONSOR_DEPLOY_REFUSED')
    expect(
      code(() => checkDeployPayload({ ...ok, expectedContractId: OTHER }))
    ).toBe('SPONSOR_DEPLOY_REFUSED')
    expect(
      code(() =>
        checkDeployPayload({
          ...ok,
          passphrase: 'Public Global Stellar Network ; September 2015',
        })
      )
    ).toBe('SPONSOR_DEPLOY_REFUSED')
  })

  it('refuses extra or missing auth, or a non-create host function', () => {
    expect(code(() => checkDeployPayload({ ...ok, auth: [] }))).toBe(
      'SPONSOR_DEPLOY_REFUSED'
    )
    expect(
      code(() => checkDeployPayload({ ...ok, auth: [...ok.auth, ...ok.auth] }))
    ).toBe('SPONSOR_DEPLOY_REFUSED')
    const invoke = xdr.HostFunction.hostFunctionTypeInvokeContract(
      new xdr.InvokeContractArgs({
        contractAddress: new Address(TAB).toScAddress(),
        functionName: 'deposit',
        args: [],
      } as never)
    )
    expect(
      code(() => checkDeployPayload({ ...ok, func: invoke.toXDR('base64') }))
    ).toBe('SPONSOR_DEPLOY_REFUSED')
    expect(code(() => checkDeployPayload({ ...ok, func: 'not xdr' }))).toBe(
      'SPONSOR_DEPLOY_REFUSED'
    )
  })

  it('refuses a deployer auth that authorizes another creation', () => {
    const e = xdr.SorobanAuthorizationEntry.fromXDR(ok.auth[0]!, 'base64')
    const other = entry({
      address: deploy.deployer,
      root: invocation(contractFn(TAB, 'deposit', [])),
    })
    expect(
      code(() => checkDeployPayload({ ...ok, auth: [other.toXDR('base64')] }))
    ).toBe('SPONSOR_DEPLOY_REFUSED')
    expect(e.rootInvocation.subInvocations.length).toBe(0)
  })
})

describe('configuration', () => {
  const env = {
    STELLAR_NETWORK: 'TESTNET',
    SPONSOR_ENABLED: 'true',
    TAB_CONTRACT_ID: TAB,
    TOKEN_CONTRACT_ID: TOKEN,
    SPONSOR_ACCOUNT_WASM_HASH: 'c5'.repeat(32),
    SPONSOR_ACCOUNT_DEPLOYER: Keypair.random().publicKey(),
    SPONSOR_ACCOUNT_VERIFIER: contract(9),
    SPONSOR_PUBLIC_KEY: Keypair.random().publicKey(),
  }

  it('refuses to turn on without the account code hash, the deployer, the verifier or the public address', () => {
    for (const name of [
      'SPONSOR_ACCOUNT_WASM_HASH',
      'SPONSOR_ACCOUNT_DEPLOYER',
      'SPONSOR_ACCOUNT_VERIFIER',
      'SPONSOR_PUBLIC_KEY',
    ]) {
      expect(code(() => sponsorConfig({ ...env, [name]: undefined }))).toBe(
        'SPONSOR_CONFIG_INVALID'
      )
      expect(code(() => sponsorConfig({ ...env, [name]: 'nope' }))).toBe(
        'SPONSOR_CONFIG_INVALID'
      )
    }
  })

  it('commits the cap plus the inclusion fee, never the simulated fee', () => {
    expect(commitStroops('open_session')).toBe(BigInt(2_000_100))
    expect(commitStroops('revoke_key')).toBe(BigInt(600_100))
    expect(commitStroops('deploy')).toBe(BigInt(400_100))
  })

  it('reads the guarded settings with defaults', () => {
    const c = sponsorConfig(env)
    expect(c.tabContractId).toBe(TAB)
    expect(c.accountVerifier).toBe(contract(9))
    expect(c.dailyBudgetStroops).toBe(BigInt(20_000_000_000))
  })

  it('refuses when disabled, misconfigured or not on testnet', () => {
    expect(
      code(() => sponsorConfig({ ...env, SPONSOR_ENABLED: 'false' }))
    ).toBe('SPONSOR_DISABLED')
    expect(code(() => sponsorConfig({ ...env, TAB_CONTRACT_ID: 'nope' }))).toBe(
      'SPONSOR_CONFIG_INVALID'
    )
    expect(
      code(() => sponsorConfig({ ...env, SPONSOR_DAILY_BUDGET_STROOPS: '1.5' }))
    ).toBe('SPONSOR_CONFIG_INVALID')
    expect(() => sponsorConfig({ ...env, STELLAR_NETWORK: 'PUBLIC' })).toThrow()
  })

  it('refuses a missing or malformed secret without echoing it', () => {
    expect(code(() => sponsorSecret({}))).toBe('SPONSOR_UNAVAILABLE')
    try {
      sponsorSecret({ SPONSOR_SECRET: 'SBADSECRETVALUE' })
    } catch (e) {
      expect(String((e as Error).message)).not.toContain('SBADSECRETVALUE')
    }
  })
})
