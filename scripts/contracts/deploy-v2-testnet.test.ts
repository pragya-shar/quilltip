/**
 * Guard and encoding tests for scripts/contracts/deploy-v2-testnet.ts.
 *
 * The deployment tool must refuse mainnet in every form: network names,
 * passphrase spellings, endpoints, CLI flags and environment overrides, and
 * an RPC server that answers with the mainnet passphrase. Nothing here talks
 * to a network or runs the Stellar CLI.
 */
import { readFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { Keypair } from '@stellar/stellar-sdk'
import { describe, expect, it, vi } from 'vitest'

import { NetworkGuardError } from '../lib/network-guard'
import {
  LIVE_BACKEND_APPROVAL_ENV,
  NETWORK_GUARD_OPT_IN_ENV,
} from '../../convex/lib/networkGuard'
import { assertScriptStellarTestnetOnly } from '../lib/network-guard'
import { acceptancePayload, sign, voucherJson } from './deploy-v2/encoding'
import { renderSection } from './deploy-v2/evidence'
import { assertKeysDirOutsideRepo } from './deploy-v2/keys'
import {
  cliCommand,
  confirmNetwork,
  resolveDeployNetwork,
  type DeployNetwork,
} from './deploy-v2/network'
import { canonical, deploySalt } from './deploy-v2/steps'
import type { DeployState } from './deploy-v2/state'
import { main, parseArgs } from './deploy-v2-testnet'
import {
  CONVEX_ENV_NAMES,
  INTEGRATION_CONVEX_DEPLOYMENT,
  convexCliEnv,
  stepConvexEnv,
} from './deploy-v2/convex-env'
import * as keys from './deploy-v2/keys'

const TESTNET_PASSPHRASE = 'Test SDF Network ; September 2015'
const MAINNET_PASSPHRASE = 'Public Global Stellar Network ; September 2015'
const LOCAL_PASSPHRASE = 'Standalone Network ; February 2017'

const TESTNET_ENV = {
  [NETWORK_GUARD_OPT_IN_ENV]: 'testnet',
  NEXT_PUBLIC_STELLAR_NETWORK: 'TESTNET',
  NEXT_PUBLIC_SOROBAN_RPC_URL: 'https://soroban-testnet.stellar.org',
  NEXT_PUBLIC_NETWORK_PASSPHRASE: TESTNET_PASSPHRASE,
}

const LOCAL_ENV = {
  [NETWORK_GUARD_OPT_IN_ENV]: 'local',
  NEXT_PUBLIC_STELLAR_NETWORK: 'LOCAL',
  NEXT_PUBLIC_SOROBAN_RPC_URL: 'http://localhost:8000/rpc',
  NEXT_PUBLIC_HORIZON_URL: 'http://localhost:8000',
  NEXT_PUBLIC_NETWORK_PASSPHRASE: LOCAL_PASSPHRASE,
}

function refusalCodes(env: Record<string, string | undefined>): string[] {
  try {
    resolveDeployNetwork(env)
  } catch (error) {
    if (error instanceof NetworkGuardError) return error.codes
    throw error
  }
  return []
}

describe('the Stellar-only guard', () => {
  it('accepts testnet without any Convex target', () => {
    expect(resolveDeployNetwork(TESTNET_ENV)).toEqual({
      operation: 'deploy-v2-testnet',
      network: 'TESTNET',
      passphrase: TESTNET_PASSPHRASE,
      rpcUrl: 'https://soroban-testnet.stellar.org',
      explorer: 'testnet',
    })
  })

  it('accepts the documented local standalone setup', () => {
    expect(resolveDeployNetwork(LOCAL_ENV)).toMatchObject({
      network: 'LOCAL',
      passphrase: LOCAL_PASSPHRASE,
      explorer: null,
    })
  })

  it.each(['MAINNET', 'PUBLIC', 'mainnet', 'Mainnet', 'PUBNET', 'FUTURENET'])(
    'refuses the network name %s',
    (network) => {
      expect(
        refusalCodes({ ...TESTNET_ENV, NEXT_PUBLIC_STELLAR_NETWORK: network })
      ).toContain('NOT_TESTNET')
    }
  )

  it('refuses a mainnet value in the second network variable', () => {
    expect(
      refusalCodes({ ...TESTNET_ENV, STELLAR_NETWORK: 'MAINNET' })
    ).toEqual(expect.arrayContaining(['CONFLICTING_NETWORK', 'NOT_TESTNET']))
  })

  it.each([
    MAINNET_PASSPHRASE,
    MAINNET_PASSPHRASE.toLowerCase(),
    MAINNET_PASSPHRASE.toUpperCase(),
    `  ${MAINNET_PASSPHRASE}  `,
    'Public  Global Stellar Network ;  September 2015',
    'Public Global Stellar Network ; September 2015',
  ])('refuses the mainnet passphrase spelled %j', (passphrase) => {
    const codes = refusalCodes({
      ...TESTNET_ENV,
      NEXT_PUBLIC_NETWORK_PASSPHRASE: passphrase,
    })
    expect(codes).toContain('MAINNET_PASSPHRASE')
  })

  it('refuses the mainnet passphrase in the second passphrase variable', () => {
    expect(
      refusalCodes({ ...TESTNET_ENV, NETWORK_PASSPHRASE: MAINNET_PASSPHRASE })
    ).toEqual(
      expect.arrayContaining(['CONFLICTING_PASSPHRASE', 'MAINNET_PASSPHRASE'])
    )
  })

  it.each([
    ['NEXT_PUBLIC_SOROBAN_RPC_URL', 'https://mainnet.sorobanrpc.com'],
    [
      'NEXT_PUBLIC_SOROBAN_RPC_URL',
      'https://soroban-rpc.mainnet.stellar.gateway.fm',
    ],
    ['STELLAR_RPC_URL', 'https://mainnet.sorobanrpc.com'],
    ['NEXT_PUBLIC_STELLAR_RPC_URL', 'https://rpc.mainnet.example.org'],
    ['NEXT_PUBLIC_HORIZON_URL', 'https://horizon.stellar.org'],
    ['HORIZON_URL', 'https://horizon.stellar.org'],
  ])('refuses the mainnet endpoint %s=%s', (name, url) => {
    expect(refusalCodes({ ...TESTNET_ENV, [name]: url })).toContain(
      'MAINNET_URL'
    )
  })

  it('refuses an endpoint that is neither testnet nor local', () => {
    expect(
      refusalCodes({
        ...TESTNET_ENV,
        STELLAR_RPC_URL: 'https://rpc.example.com',
      })
    ).toContain('UNTRUSTED_URL')
  })

  it('refuses a run without the opt-in, or with the wrong one', () => {
    const { [NETWORK_GUARD_OPT_IN_ENV]: _, ...withoutOptIn } = TESTNET_ENV
    expect(refusalCodes(withoutOptIn)).toContain('MISSING_OPT_IN')
    expect(
      refusalCodes({ ...TESTNET_ENV, [NETWORK_GUARD_OPT_IN_ENV]: 'local' })
    ).toContain('OPT_IN_MISMATCH')
    expect(
      refusalCodes({ ...TESTNET_ENV, [NETWORK_GUARD_OPT_IN_ENV]: 'mainnet' })
    ).toContain('OPT_IN_MISMATCH')
  })

  it('refuses LOCAL mode with a remote endpoint or the testnet passphrase', () => {
    expect(
      refusalCodes({
        ...LOCAL_ENV,
        NEXT_PUBLIC_SOROBAN_RPC_URL: 'https://soroban-testnet.stellar.org',
      })
    ).toContain('LOCAL_REMOTE_URL')
    expect(
      refusalCodes({
        ...LOCAL_ENV,
        NEXT_PUBLIC_NETWORK_PASSPHRASE: TESTNET_PASSPHRASE,
      })
    ).toContain('UNKNOWN_PASSPHRASE')
  })

  it('refuses while a Convex deploy key or a live-backend approval is set', () => {
    expect(
      refusalCodes({ ...TESTNET_ENV, CONVEX_DEPLOY_KEY: 'prod:example|secret' })
    ).toContain('CONVEX_KEY_FOR_STELLAR_ONLY')
    expect(
      refusalCodes({
        ...TESTNET_ENV,
        [LIVE_BACKEND_APPROVAL_ENV]: 'some-deployment',
      })
    ).toContain('APPROVAL_NOT_FOR_DEPLOY')
  })

  it('never prints the deploy key value', () => {
    try {
      assertScriptStellarTestnetOnly('test', {
        ...TESTNET_ENV,
        CONVEX_DEPLOY_KEY: 'prod:example|do-not-print-me',
      })
    } catch (error) {
      expect(String(error)).not.toContain('do-not-print-me')
    }
  })
})

describe('the Stellar CLI command', () => {
  const ctx = { configDir: '/keys/integration', env: TESTNET_ENV }

  it('passes the testnet network, RPC URL and passphrase explicitly', () => {
    const built = cliCommand(
      { ...ctx, net: resolveDeployNetwork(TESTNET_ENV) },
      ['contract', 'deploy', '--wasm-hash', 'ab', '--', '--admin', 'G']
    )
    expect(built.network).toBe('TESTNET')
    expect(built.args).toEqual([
      'contract',
      'deploy',
      '--wasm-hash',
      'ab',
      '--config-dir',
      '/keys/integration',
      '--network',
      'testnet',
      '--rpc-url',
      'https://soroban-testnet.stellar.org',
      '--network-passphrase',
      TESTNET_PASSPHRASE,
      '--',
      '--admin',
      'G',
    ])
    expect(built.env.STELLAR_NETWORK).toBe('testnet')
    expect(built.env.STELLAR_NETWORK_PASSPHRASE).toBe(TESTNET_PASSPHRASE)
  })

  it.each([
    ['--network', 'mainnet'],
    ['--network=mainnet'],
    ['-n', 'mainnet'],
    ['-qn', 'mainnet'],
    ['--rpc-url', 'https://mainnet.sorobanrpc.com'],
    ['--network-passphrase', MAINNET_PASSPHRASE],
  ])('refuses a caller network flag %j', (...flag) => {
    expect(() =>
      cliCommand({ ...ctx, net: resolveDeployNetwork(TESTNET_ENV) }, [
        'contract',
        'invoke',
        ...flag,
      ])
    ).toThrow(NetworkGuardError)
  })

  it('re-runs the guard for every command, so a changed environment is refused', () => {
    const net = resolveDeployNetwork(TESTNET_ENV)
    expect(() =>
      cliCommand(
        {
          net,
          configDir: '/keys',
          env: { ...TESTNET_ENV, NEXT_PUBLIC_STELLAR_NETWORK: 'MAINNET' },
        },
        ['contract', 'upload', '--wasm', 'x.wasm']
      )
    ).toThrow(NetworkGuardError)
  })
})

describe('the RPC passphrase check before each submission', () => {
  const net: DeployNetwork = resolveDeployNetwork(TESTNET_ENV)
  const answering = (passphrase: string) =>
    vi.fn(
      async () =>
        new Response(
          JSON.stringify({ jsonrpc: '2.0', id: 1, result: { passphrase } })
        )
    )

  it('passes when the server serves testnet', async () => {
    await expect(
      confirmNetwork(net, answering(TESTNET_PASSPHRASE))
    ).resolves.toBeUndefined()
  })

  it.each([
    MAINNET_PASSPHRASE,
    MAINNET_PASSPHRASE.toUpperCase(),
    ` ${MAINNET_PASSPHRASE} `,
  ])(
    'refuses a server that answers with the mainnet passphrase %j',
    async (passphrase) => {
      await expect(
        confirmNetwork(net, answering(passphrase))
      ).rejects.toMatchObject({
        codes: ['MAINNET_PASSPHRASE'],
      })
    }
  )

  it('refuses a server on another network', async () => {
    await expect(
      confirmNetwork(net, answering(LOCAL_PASSPHRASE))
    ).rejects.toMatchObject({
      codes: ['UNKNOWN_PASSPHRASE'],
    })
  })
})

describe('the entry point', () => {
  const args = [
    '--set',
    'integration',
    '--commit',
    'a'.repeat(40),
    '--keys-dir',
    join(tmpdir(), 'qt-keys'),
  ]

  it('refuses mainnet before any other work', async () => {
    await expect(
      main(args, { ...TESTNET_ENV, NEXT_PUBLIC_STELLAR_NETWORK: 'MAINNET' })
    ).rejects.toBeInstanceOf(NetworkGuardError)
  })

  it('validates its arguments', () => {
    expect(parseArgs(args)).toMatchObject({
      set: 'integration',
      steps: expect.arrayContaining(['build', 'smoke']),
    })
    expect(() => parseArgs(['--set', 'mainnet', ...args.slice(2)])).toThrow(
      /--set/
    )
    expect(() =>
      parseArgs(['--set', 'live', '--commit', 'abc', '--keys-dir', 'x'])
    ).toThrow(/--commit/)
    expect(() => parseArgs([...args, '--steps', 'deploy,launch'])).toThrow(
      /Unknown step/
    )
  })

  it('refuses a key directory inside the repository', () => {
    expect(() => assertKeysDirOutsideRepo('scripts/contracts')).toThrow(
      /inside the repository/
    )
    expect(assertKeysDirOutsideRepo(join(tmpdir(), 'qt-keys'))).toContain(
      'qt-keys'
    )
  })
})

describe('encodings', () => {
  const vectors = JSON.parse(
    readFileSync(
      join(__dirname, '../../contracts/shared/test-vectors.json'),
      'utf8'
    )
  ) as {
    keys: Record<string, { seed: string; public_key: string }>
    vouchers: Array<{
      case: string
      payload_xdr: string
      acceptance_payload_xdr: string
      acceptance_signature: string
      signature?: string
    }>
  }
  const acceptor = Keypair.fromRawEd25519Seed(
    Buffer.from(vectors.keys.acceptor!.seed, 'hex')
  )
  const session = Keypair.fromRawEd25519Seed(
    Buffer.from(vectors.keys.session!.seed, 'hex')
  )

  it.each(vectors.vouchers.map((v) => [v.case, v] as const))(
    'acceptance payload and signature match the shared vector (%s)',
    (_name, vector) => {
      const payload = Buffer.from(vector.payload_xdr, 'hex')
      expect(acceptancePayload(payload).toString('hex')).toBe(
        vector.acceptance_payload_xdr
      )
      expect(sign(acceptor, acceptancePayload(payload))).toBe(
        vector.acceptance_signature
      )
      if (vector.signature)
        expect(sign(session, payload)).toBe(vector.signature)
    }
  )

  it('builds the CLI voucher JSON with and without an acceptance', () => {
    const payload = Buffer.from(vectors.vouchers[0]!.payload_xdr, 'hex')
    const base = {
      reader: 'GR',
      writer: 'GW',
      keyId: 0,
      cumulative: BigInt(3_900_000),
      receiptsRoot: '00',
      payload,
      session,
    }
    expect(voucherJson(base)).toMatchObject({
      cumulative: '3900000',
      acceptor: null,
      acceptance_signature: null,
    })
    expect(voucherJson({ ...base, acceptor })).toMatchObject({
      acceptor: vectors.keys.acceptor!.public_key,
      acceptance_signature: vectors.vouchers[0]!.acceptance_signature,
    })
  })

  it('derives a deterministic deploy salt per set, contract and commit', () => {
    const salt = deploySalt('integration', 'core', 'a'.repeat(40))
    expect(salt).toMatch(/^[0-9a-f]{64}$/)
    expect(deploySalt('integration', 'core', 'a'.repeat(40))).toBe(salt)
    expect(deploySalt('live', 'core', 'a'.repeat(40))).not.toBe(salt)
    expect(deploySalt('integration', 'tab', 'a'.repeat(40))).not.toBe(salt)
  })

  it('compares read-back values regardless of key order', () => {
    expect(canonical({ b: 1, a: [{ d: 2, c: 3 }] })).toBe(
      canonical({ a: [{ c: 3, d: 2 }], b: 1 })
    )
  })
})

describe('the evidence document', () => {
  it('contains public keys only', () => {
    const secret = Keypair.random()
    const state: DeployState = {
      version: 1,
      set: 'integration',
      network: 'TESTNET',
      passphrase: TESTNET_PASSPHRASE,
      commit: 'a'.repeat(40),
      build: {
        commit: 'a'.repeat(40),
        outDir: '/tmp',
        image: 'img@sha256:00',
        stellarCli: 'stellar 30.0.1',
        reproduced: true,
        wasm: {
          core: { sha256: '11'.repeat(32), bytes: 1 },
          tab: { sha256: '22'.repeat(32), bytes: 2 },
          nft: { sha256: '33'.repeat(32), bytes: 3 },
        },
      },
      keys: { admin: secret.publicKey() },
    }
    const doc = renderSection(state, resolveDeployNetwork(TESTNET_ENV), {})
    expect(doc).toContain(secret.publicKey())
    expect(doc).not.toContain(secret.secret())
    expect(doc).toContain('testnet')
  })
})

describe('the integration Convex env step', () => {
  const ctx = {
    net: resolveDeployNetwork(TESTNET_ENV),
    configDir: '/keys',
    env: TESTNET_ENV,
  }
  const settler = Keypair.random()
  const acceptor = Keypair.random()
  const verified = {
    version: 1 as const,
    set: 'integration' as const,
    network: 'TESTNET' as const,
    passphrase: TESTNET_PASSPHRASE,
    nativeSac: 'CSAC',
    contracts: {
      core: {
        id: 'CCORE',
        salt: '',
        tx: { hash: 'h', ledger: 4242, feeCharged: '1' },
      },
      tab: { id: 'CTAB', salt: '', tx: null },
      nft: { id: 'CNFT', salt: '', tx: null },
    },
    verify: { at: '', checks: [], ok: true },
  }

  it('never targets the live deployment', () => {
    expect(() => convexCliEnv('upbeat-mockingbird-579', TESTNET_ENV)).toThrow(
      /live deployment/
    )
    expect(
      convexCliEnv(INTEGRATION_CONVEX_DEPLOYMENT, TESTNET_ENV).CONVEX_DEPLOYMENT
    ).toBe(`dev:${INTEGRATION_CONVEX_DEPLOYMENT}`)
  })

  it('runs only for the integration set on testnet', async () => {
    await expect(
      stepConvexEnv(ctx, { ...verified, set: 'live' }, () => {})
    ).rejects.toThrow(/integration set on testnet/)
    await expect(
      stepConvexEnv(ctx, { ...verified, network: 'LOCAL' }, () => {})
    ).rejects.toThrow(/integration set on testnet/)
  })

  it('sets nothing when the backend is not on testnet', async () => {
    const run = vi.fn(() => ({ status: 0, stdout: 'MAINNET' }))
    await expect(stepConvexEnv(ctx, verified, () => {}, run)).rejects.toThrow(
      /STELLAR_NETWORK=TESTNET/
    )
    expect(run).toHaveBeenCalledTimes(1)
  })

  it('passes values on stdin and never logs them', async () => {
    vi.spyOn(keys, 'signer').mockImplementation((_ctx, name) =>
      name.endsWith('settler') ? settler : acceptor
    )
    const calls: Array<{ args: string[]; input?: string }> = []
    const run = vi.fn((args: string[], _env: unknown, input?: string) => {
      calls.push({ args, input })
      return { status: 0, stdout: args[1] === 'get' ? 'TESTNET' : '' }
    })
    const logs: string[] = []
    await expect(
      stepConvexEnv(ctx, verified, (l) => logs.push(l), run)
    ).resolves.toEqual([...CONVEX_ENV_NAMES])
    const sets = calls.filter((c) => c.args[1] === 'set')
    expect(sets.map((c) => c.args)).toEqual(
      CONVEX_ENV_NAMES.map((n) => ['env', 'set', n])
    )
    expect(sets.map((c) => c.input)).toEqual([
      'CCORE',
      'CTAB',
      'CNFT',
      'CSAC',
      '4242',
      settler.secret(),
      acceptor.secret(),
    ])
    const printed = JSON.stringify({ logs, args: calls.map((c) => c.args) })
    expect(printed).not.toContain(settler.secret())
    expect(printed).not.toContain(acceptor.secret())
  })
})
