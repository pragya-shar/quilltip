/**
 * Input-variation tests for the v2 guard variables, LOCAL mode, and the
 * Stellar CLI wrapper: URL and passphrase forms, variable precedence, LOCAL
 * with cloud or live targets, and caller arguments to the CLI.
 */
import { describe, expect, it, vi } from 'vitest'

import {
  LOCAL_PASSPHRASE,
  MAINNET_PASSPHRASE,
  StellarNetworkConfigError,
  TESTNET_PASSPHRASE,
  pickRpcUrl,
} from '../../lib/stellar/network'
import {
  LIVE_BACKEND_APPROVAL_ENV,
  NETWORK_GUARD_OPT_IN_ENV,
  NetworkGuardError,
  assertBackendNetwork,
  assertBackendTestnet,
  assertClientNetwork,
  assertNonProductionBackend,
  collectNetworkGuardRefusals,
  type NetworkGuardInput,
} from '../../lib/stellar/network-guard'
import { checkConvexDev } from '../convex-dev'
import {
  assertScriptConvexDeployAllowed,
  assertScriptTestnetOnly,
  resolveScriptStellarNetwork,
} from '../lib/network-guard'
import { buildStellarCliCommand, runStellarCli } from '../lib/stellar-cli'

const LIVE = 'upbeat-mockingbird-579'
const ALLOWED = 'efficient-tern-39'
const TESTNET_RPC = 'https://soroban-testnet.stellar.org'
const LOCAL_RPC = 'http://localhost:8000/soroban/rpc'
const LOCAL_CONVEX = 'http://127.0.0.1:3210'

const TESTNET_ENV = {
  [NETWORK_GUARD_OPT_IN_ENV]: 'testnet',
  NEXT_PUBLIC_STELLAR_NETWORK: 'TESTNET',
  NEXT_PUBLIC_STELLAR_RPC_URL: TESTNET_RPC,
  NEXT_PUBLIC_NETWORK_PASSPHRASE: TESTNET_PASSPHRASE,
  CONVEX_DEPLOYMENT: `dev:${ALLOWED}`,
  NEXT_PUBLIC_CONVEX_URL: `https://${ALLOWED}.convex.cloud`,
}

const LOCAL_ENV = {
  [NETWORK_GUARD_OPT_IN_ENV]: 'local',
  NEXT_PUBLIC_STELLAR_NETWORK: 'LOCAL',
  NEXT_PUBLIC_STELLAR_RPC_URL: LOCAL_RPC,
  NEXT_PUBLIC_NETWORK_PASSPHRASE: LOCAL_PASSPHRASE,
  CONVEX_DEPLOYMENT: 'local:local-quilltip',
  NEXT_PUBLIC_CONVEX_URL: LOCAL_CONVEX,
}

const LOCAL_INPUT: NetworkGuardInput = {
  operation: 'local input test',
  kind: 'operational',
  optIn: 'local',
  stellarNetworks: ['LOCAL'],
  networkPassphrases: [LOCAL_PASSPHRASE],
  stellarUrls: [LOCAL_RPC],
  convexDeployment: 'local:local-quilltip',
}

function codes(fn: () => unknown): string[] {
  try {
    fn()
  } catch (error) {
    if (error instanceof NetworkGuardError) {
      return error.refusals.map((r) => r.code)
    }
    throw error
  }
  return []
}

function refusalCodes(input: NetworkGuardInput): string[] {
  return collectNetworkGuardRefusals(input).map((r) => r.code)
}

describe('LOCAL mode never reaches a cloud or live backend', () => {
  it('accepts the documented LOCAL setup', () => {
    expect(refusalCodes(LOCAL_INPUT)).toEqual([])
    expect(assertScriptTestnetOnly('local', LOCAL_ENV).network).toBe('LOCAL')
  })

  it.each([
    ['an allowlisted deployment', { CONVEX_DEPLOYMENT: `dev:${ALLOWED}` }],
    ['the live deployment', { CONVEX_DEPLOYMENT: `prod:${LIVE}` }],
    [
      'a cloud URL beside a local deployment',
      { NEXT_PUBLIC_CONVEX_URL: `https://${ALLOWED}.convex.cloud` },
    ],
    ['a cloud CONVEX_URL', { CONVEX_URL: `https://${ALLOWED}.convex.site` }],
    [
      'a remote self-hosted backend',
      { CONVEX_SELF_HOSTED_URL: 'https://convex.example.com' },
    ],
    [
      'a cloud deploy key beside a local deployment',
      { CONVEX_DEPLOY_KEY: `dev:${ALLOWED}|token` },
    ],
    [
      'a loopback lookalike host',
      { NEXT_PUBLIC_CONVEX_URL: 'http://127.0.0.1.nip.io:3210' },
    ],
  ])('refuses %s', (_label, extra) => {
    expect(
      codes(() => assertScriptTestnetOnly('local', { ...LOCAL_ENV, ...extra }))
    ).toContain('LOCAL_CLOUD_CONVEX')
  })

  it('refuses the live approval with a local target', () => {
    expect(
      codes(() =>
        assertScriptTestnetOnly('local', {
          ...LOCAL_ENV,
          [LIVE_BACKEND_APPROVAL_ENV]: LIVE,
        })
      )
    ).toContain('LOCAL_LIVE_APPROVAL')
  })

  it('never approves the live backend in LOCAL mode', () => {
    const refusals = refusalCodes({
      ...LOCAL_INPUT,
      convexDeployment: `prod:${LIVE}`,
      liveBackendApproval: LIVE,
    })
    expect(refusals).toContain('LOCAL_LIVE_APPROVAL')
    expect(refusals).toContain('LOCAL_CLOUD_CONVEX')
    expect(refusals).toContain('LIVE_BACKEND_NOT_APPROVED')
  })

  it('keeps refusing the live approval for deploy kind in both modes', () => {
    for (const env of [TESTNET_ENV, LOCAL_ENV]) {
      expect(
        codes(() =>
          assertScriptConvexDeployAllowed('deploy', {
            ...env,
            [LIVE_BACKEND_APPROVAL_ENV]: LIVE,
          })
        )
      ).toContain('APPROVAL_NOT_FOR_DEPLOY')
    }
  })

  it('refuses a cloud target for convex dev under the local opt-in', () => {
    expect(
      codes(() =>
        checkConvexDev([], {
          [NETWORK_GUARD_OPT_IN_ENV]: 'local',
          CONVEX_DEPLOYMENT: `dev:${ALLOWED}`,
        })
      )
    ).toContain('LOCAL_CLOUD_CONVEX')
    expect(
      codes(() =>
        checkConvexDev([], {
          [NETWORK_GUARD_OPT_IN_ENV]: 'local',
          CONVEX_DEPLOYMENT: 'local:local-quilltip',
        })
      )
    ).toEqual([])
  })

  it.each(['LOCAL', 'Local', ' testnet', 'yes', 'local,testnet'])(
    'refuses the opt-in %j with the LOCAL network',
    (optIn) => {
      expect(
        refusalCodes({ ...LOCAL_INPUT, optIn }).some((c) =>
          ['OPT_IN_MISMATCH', 'MISSING_OPT_IN'].includes(c)
        )
      ).toBe(true)
    }
  )

  it('refuses the local opt-in with the TESTNET network', () => {
    expect(
      codes(() =>
        assertScriptTestnetOnly('testnet', {
          ...TESTNET_ENV,
          [NETWORK_GUARD_OPT_IN_ENV]: 'local',
        })
      )
    ).toContain('OPT_IN_MISMATCH')
  })

  it.each(['local', 'Local', 'ＬＯＣＡＬ', 'STANDALONE', 'LOCAL​'])(
    'refuses the network spelling %j',
    (network) => {
      expect(
        refusalCodes({ ...LOCAL_INPUT, stellarNetworks: [network] })
      ).toContain('NOT_TESTNET')
    }
  )

  it('refuses TESTNET and LOCAL set together', () => {
    expect(
      codes(() =>
        assertScriptTestnetOnly('mixed', {
          ...LOCAL_ENV,
          STELLAR_NETWORK: 'TESTNET',
        })
      )
    ).toContain('CONFLICTING_NETWORK')
  })
})

describe('LOCAL mode endpoints', () => {
  it.each([
    'http://localhost:8000/soroban/rpc',
    'http://LOCALHOST:8000/soroban/rpc',
    'http://127.0.0.1:8000/soroban/rpc',
  ])('accepts %s', (url) => {
    expect(refusalCodes({ ...LOCAL_INPUT, stellarUrls: [url] })).toEqual([])
  })

  it.each([
    ['https://soroban-testnet.stellar.org', 'LOCAL_REMOTE_URL'],
    ['http://localhost:8000@soroban-testnet.stellar.org', 'LOCAL_REMOTE_URL'],
    ['http://127.0.0.1@horizon.stellar.org', 'MAINNET_URL'],
    ['http://localhost.evil.example:8000', 'LOCAL_REMOTE_URL'],
    ['http://127.0.0.1.nip.io:8000', 'LOCAL_REMOTE_URL'],
    ['http://0.0.0.0:8000', 'LOCAL_REMOTE_URL'],
    ['http://[::ffff:127.0.0.1]:8000', 'LOCAL_REMOTE_URL'],
    ['ws://localhost:8000', 'INVALID_URL'],
    ['file:///tmp/rpc', 'INVALID_URL'],
    ['localhost:8000', 'INVALID_URL'],
  ])('refuses %s', (url, code) => {
    expect(refusalCodes({ ...LOCAL_INPUT, stellarUrls: [url] })).toContain(code)
  })

  it('ignores the unlisted-host allowance in LOCAL mode', () => {
    expect(
      refusalCodes({
        ...LOCAL_INPUT,
        allowUnlistedUrls: true,
        stellarUrls: ['https://rpc.example.com'],
      })
    ).toContain('LOCAL_REMOTE_URL')
  })

  it.each([
    [TESTNET_PASSPHRASE, 'UNKNOWN_PASSPHRASE'],
    [MAINNET_PASSPHRASE, 'MAINNET_PASSPHRASE'],
    ['standalone network ; february 2017', 'UNKNOWN_PASSPHRASE'],
  ])('refuses the passphrase %j', (passphrase, code) => {
    expect(
      refusalCodes({ ...LOCAL_INPUT, networkPassphrases: [passphrase] })
    ).toContain(code)
  })

  it('refuses the standalone passphrase on TESTNET', () => {
    expect(
      codes(() =>
        assertScriptTestnetOnly('testnet', {
          ...TESTNET_ENV,
          NETWORK_PASSPHRASE: LOCAL_PASSPHRASE,
          NEXT_PUBLIC_NETWORK_PASSPHRASE: LOCAL_PASSPHRASE,
        })
      )
    ).toContain('UNKNOWN_PASSPHRASE')
  })
})

describe('mainnet values in the v2 variables', () => {
  const mainnetUrls = [
    'https://mainnet.sorobanrpc.com',
    'HTTPS://MAINNET.SOROBANRPC.COM:443/',
    'https://horizon.stellar.org.',
    'https://user:pass@horizon.stellar.org/',
    'https://horizon．stellar．org',
    'https://ｈｏｒｉｚｏｎ.stellar.org',
    'https://horizon%2Estellar.org',
    'https://soroban-rpc.mainnet.stellar.gateway.fm',
    'https://rpc-mainnet.example.com',
  ]

  it.each(mainnetUrls)('scripts refuse STELLAR_RPC_URL=%s', (url) => {
    expect(
      codes(() =>
        assertScriptTestnetOnly('rpc', { ...TESTNET_ENV, STELLAR_RPC_URL: url })
      )
    ).toContain('MAINNET_URL')
  })

  it.each(mainnetUrls)('scripts refuse the earlier RPC name=%s', (url) => {
    expect(
      codes(() =>
        assertScriptTestnetOnly('rpc', {
          ...TESTNET_ENV,
          NEXT_PUBLIC_SOROBAN_RPC_URL: url,
        })
      )
    ).toContain('MAINNET_URL')
  })

  it.each(mainnetUrls)('the backend refuses STELLAR_RPC_URL=%s', (url) => {
    expect(codes(() => assertBackendTestnet({ STELLAR_RPC_URL: url }))).toEqual(
      ['MAINNET_URL']
    )
  })

  it.each(mainnetUrls)('the client refuses an RPC URL of %s', (url) => {
    expect(
      codes(() =>
        assertClientNetwork({
          network: 'TESTNET',
          passphrase: TESTNET_PASSPHRASE,
          horizonUrl: 'https://horizon-testnet.stellar.org',
          rpcUrl: url,
        })
      )
    ).toEqual(['MAINNET_URL'])
  })

  const mainnetPassphrases = [
    MAINNET_PASSPHRASE,
    MAINNET_PASSPHRASE.toLowerCase(),
    MAINNET_PASSPHRASE.toUpperCase(),
    ` ${MAINNET_PASSPHRASE}\n`,
    MAINNET_PASSPHRASE.replace(/ /g, '  '),
    MAINNET_PASSPHRASE.replace(/ /g, ' '),
    MAINNET_PASSPHRASE.replace(/ /g, '\t'),
    'Ｐｕｂｌｉｃ Global Stellar Network ; September 2015',
  ]

  it.each(mainnetPassphrases)('refuses the passphrase %j', (passphrase) => {
    expect(
      codes(() =>
        assertScriptTestnetOnly('pass', {
          ...TESTNET_ENV,
          NETWORK_PASSPHRASE: passphrase,
        })
      )
    ).toContain('MAINNET_PASSPHRASE')
    expect(
      codes(() => assertBackendTestnet({ NETWORK_PASSPHRASE: passphrase }))
    ).toEqual(['MAINNET_PASSPHRASE'])
  })

  it.each([
    'Public Global Stellar Network;September 2015',
    'Public​Global Stellar Network ; September 2015',
    'Test SDF Network ; September 2015 ',
  ])('refuses any inexact passphrase %j', (passphrase) => {
    const refused = refusalCodes({
      operation: 'pass',
      requireOptIn: false,
      checkConvex: false,
      stellarNetworks: ['TESTNET'],
      networkPassphrases: [`${passphrase}x`],
    })
    expect(refused.length).toBeGreaterThan(0)
  })
})

describe('variable precedence', () => {
  it('refuses a mainnet value in any RPC variable, whichever is used', () => {
    for (const name of [
      'STELLAR_RPC_URL',
      'NEXT_PUBLIC_STELLAR_RPC_URL',
      'NEXT_PUBLIC_SOROBAN_RPC_URL',
    ]) {
      expect(
        codes(() =>
          resolveScriptStellarNetwork('rpc', {
            ...TESTNET_ENV,
            STELLAR_RPC_URL: TESTNET_RPC,
            [name]: 'https://mainnet.sorobanrpc.com',
          })
        )
      ).toContain('MAINNET_URL')
    }
  })

  it('refuses passphrase variables that disagree', () => {
    expect(
      codes(() =>
        assertScriptTestnetOnly('pass', {
          ...TESTNET_ENV,
          NETWORK_PASSPHRASE: TESTNET_PASSPHRASE,
          NEXT_PUBLIC_NETWORK_PASSPHRASE: MAINNET_PASSPHRASE,
        })
      )
    ).toEqual(
      expect.arrayContaining(['CONFLICTING_PASSPHRASE', 'MAINNET_PASSPHRASE'])
    )
  })

  it('refuses a mainnet Horizon value beside a testnet one', () => {
    expect(
      codes(() =>
        resolveScriptStellarNetwork('horizon', {
          ...TESTNET_ENV,
          HORIZON_URL: 'https://horizon-testnet.stellar.org',
          NEXT_PUBLIC_HORIZON_URL: 'https://horizon.stellar.org',
        })
      )
    ).toContain('MAINNET_URL')
  })

  it('uses STELLAR_RPC_URL first, then the public names', () => {
    expect(
      resolveScriptStellarNetwork('rpc', {
        ...TESTNET_ENV,
        STELLAR_RPC_URL: 'http://localhost:9000/rpc',
      }).rpcUrl
    ).toBe('http://localhost:9000/rpc')
    expect(resolveScriptStellarNetwork('rpc', TESTNET_ENV).rpcUrl).toBe(
      TESTNET_RPC
    )
  })

  it('refuses the two public RPC names when they differ', () => {
    expect(() => pickRpcUrl(TESTNET_RPC, 'http://localhost:9000/rpc')).toThrow(
      StellarNetworkConfigError
    )
    expect(() =>
      resolveScriptStellarNetwork('rpc', {
        ...TESTNET_ENV,
        STELLAR_RPC_URL: TESTNET_RPC,
        NEXT_PUBLIC_SOROBAN_RPC_URL: 'http://localhost:9000/rpc',
      })
    ).toThrow(StellarNetworkConfigError)
  })
})

describe('backend and client LOCAL checks', () => {
  const backendLocal = {
    STELLAR_NETWORK: 'LOCAL',
    [NETWORK_GUARD_OPT_IN_ENV]: 'local',
    CONVEX_CLOUD_URL: LOCAL_CONVEX,
  }

  it('accepts LOCAL on a local backend and keeps tip flows TESTNET-only', () => {
    expect(assertBackendNetwork(backendLocal)).toBe('LOCAL')
    expect(codes(() => assertBackendTestnet(backendLocal))).toEqual([
      'NOT_TESTNET',
    ])
  })

  it.each([
    ['a cloud URL', { CONVEX_CLOUD_URL: `https://${LIVE}.convex.cloud` }],
    ['no URL', { CONVEX_CLOUD_URL: undefined }],
    ['no opt-in', { [NETWORK_GUARD_OPT_IN_ENV]: undefined }],
    ['the testnet opt-in', { [NETWORK_GUARD_OPT_IN_ENV]: 'testnet' }],
    ['a remote RPC', { STELLAR_RPC_URL: 'https://rpc.example.com' }],
    ['the testnet passphrase', { NETWORK_PASSPHRASE: TESTNET_PASSPHRASE }],
  ])('refuses backend LOCAL with %s', (_label, extra) => {
    expect(
      codes(() => assertBackendNetwork({ ...backendLocal, ...extra })).length
    ).toBeGreaterThan(0)
  })

  it('refuses maintenance work in LOCAL mode on a cloud deployment', () => {
    expect(
      codes(() =>
        assertNonProductionBackend('seed', {
          ...backendLocal,
          CONVEX_CLOUD_URL: `https://${ALLOWED}.convex.cloud`,
        })
      )
    ).toContain('LOCAL_CLOUD_CONVEX')
  })

  it.each([
    undefined,
    `https://${ALLOWED}.convex.cloud`,
    'http://localhost.example.com:3210',
  ])('refuses client LOCAL with NEXT_PUBLIC_CONVEX_URL=%s', (convexUrl) => {
    expect(
      codes(() =>
        assertClientNetwork({
          network: 'LOCAL',
          passphrase: LOCAL_PASSPHRASE,
          horizonUrl: 'http://localhost:8000',
          rpcUrl: LOCAL_RPC,
          convexUrl,
        })
      ).length
    ).toBeGreaterThan(0)
  })

  it('refuses client LOCAL with a remote RPC even with unlisted hosts allowed', () => {
    expect(
      codes(() =>
        assertClientNetwork({
          network: 'LOCAL',
          passphrase: LOCAL_PASSPHRASE,
          horizonUrl: 'http://localhost:8000',
          rpcUrl: 'https://rpc.example.com',
          convexUrl: LOCAL_CONVEX,
        })
      )
    ).toEqual(['LOCAL_REMOTE_URL'])
  })
})

describe('Stellar CLI wrapper arguments', () => {
  const networkFlags = (env = TESTNET_ENV) => [
    '--network',
    env === LOCAL_ENV ? 'local' : 'testnet',
    '--rpc-url',
    env === LOCAL_ENV ? LOCAL_RPC : TESTNET_RPC,
    '--network-passphrase',
    env === LOCAL_ENV ? LOCAL_PASSPHRASE : TESTNET_PASSPHRASE,
  ]

  it.each([
    [['-nmainnet']],
    [['-qn', 'mainnet']],
    [['-vn=mainnet']],
    [['-n=mainnet']],
  ])('refuses the short network flag form %j', (flags) => {
    expect(
      codes(() =>
        buildStellarCliCommand('cli', ['contract', 'invoke', ...flags], {
          ...TESTNET_ENV,
        })
      )
    ).toEqual(['CLI_NETWORK_FLAG'])
  })

  it('puts the network flags before the contract function separator', () => {
    const built = buildStellarCliCommand(
      'invoke',
      ['contract', 'invoke', '--id', 'C1', '--', 'tip', '--amount', '1'],
      TESTNET_ENV
    )
    expect(built.args).toEqual([
      'contract',
      'invoke',
      '--id',
      'C1',
      ...networkFlags(),
      '--',
      'tip',
      '--amount',
      '1',
    ])
  })

  it('passes contract function arguments after the separator unchanged', () => {
    const built = buildStellarCliCommand(
      'invoke',
      ['contract', 'invoke', '--id', 'C1', '--', 'set', '--network', 'x'],
      LOCAL_ENV
    )
    expect(built.args.slice(-4)).toEqual(['--', 'set', '--network', 'x'])
    expect(built.args.slice(4, 10)).toEqual(networkFlags(LOCAL_ENV))
  })

  it('refuses network flags before the separator', () => {
    expect(
      codes(() =>
        buildStellarCliCommand(
          'invoke',
          ['contract', 'invoke', '-n', 'mainnet', '--', 'tip'],
          TESTNET_ENV
        )
      )
    ).toEqual(['CLI_NETWORK_FLAG'])
  })

  it('does not print refused flag values', () => {
    try {
      buildStellarCliCommand(
        'cli',
        ['-nSBSECRETVALUE', '--network-passphrase=Public Global'],
        TESTNET_ENV
      )
    } catch (error) {
      expect(String(error)).not.toContain('SBSECRETVALUE')
      expect(String(error)).not.toContain('Public Global')
      return
    }
    throw new Error('expected a refusal')
  })

  it('replaces every CLI network variable in the child env', () => {
    const built = buildStellarCliCommand('cli', ['contract', 'build'], {
      ...TESTNET_ENV,
      STELLAR_NETWORK_PASSPHRASE: MAINNET_PASSPHRASE,
      SOROBAN_NETWORK: 'mainnet',
      SOROBAN_NETWORK_PASSPHRASE: MAINNET_PASSPHRASE,
      SOROBAN_RPC_URL: 'https://mainnet.sorobanrpc.com',
      STELLAR_RPC_HEADERS: 'x:y',
    })
    expect(built.env.STELLAR_NETWORK).toBe('testnet')
    expect(built.env.STELLAR_RPC_URL).toBe(TESTNET_RPC)
    expect(built.env.STELLAR_NETWORK_PASSPHRASE).toBe(TESTNET_PASSPHRASE)
    for (const name of [
      'SOROBAN_NETWORK',
      'SOROBAN_NETWORK_PASSPHRASE',
      'SOROBAN_RPC_URL',
      'STELLAR_RPC_HEADERS',
    ]) {
      expect(built.env[name]).toBeUndefined()
    }
  })

  it('never spawns when LOCAL mode carries the live approval', () => {
    const spawn = vi.fn()
    expect(
      codes(() =>
        runStellarCli('cli', ['contract', 'deploy'], {
          env: { ...LOCAL_ENV, [LIVE_BACKEND_APPROVAL_ENV]: LIVE },
          spawn,
        })
      )
    ).toContain('LOCAL_LIVE_APPROVAL')
    expect(spawn).not.toHaveBeenCalled()
  })

  it('never spawns for a mainnet setting', () => {
    const spawn = vi.fn()
    expect(
      codes(() =>
        runStellarCli('cli', ['contract', 'deploy'], {
          env: {
            ...TESTNET_ENV,
            NEXT_PUBLIC_STELLAR_NETWORK: 'MAINNET',
            STELLAR_NETWORK: 'MAINNET',
          },
          spawn,
        })
      )
    ).toContain('NOT_TESTNET')
    expect(spawn).not.toHaveBeenCalled()
  })
})
