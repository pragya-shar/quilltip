import { execFileSync } from 'child_process'
import fs from 'fs'
import os from 'os'
import path from 'path'

import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  LOCAL_PASSPHRASE,
  MAINNET_PASSPHRASE,
  StellarNetworkConfigError,
  TESTNET_PASSPHRASE,
} from '../../lib/stellar/network'
import {
  ALLOWED_CONVEX_DEPLOYMENTS,
  LIVE_BACKEND_APPROVAL_ENV,
  LIVE_CONVEX_DEPLOYMENTS,
  LIVE_WINDOW_APPROVAL_ENV,
  NETWORK_GUARD_OPT_IN_ENV,
  NetworkGuardError,
  assertBackendNetwork,
  assertBackendTestnet,
  assertClientNetwork,
  assertNonProductionBackend,
  assertTestnetOnly,
  collectNetworkGuardRefusals,
  convexDeploymentNameFromUrl,
  parseConvexDeploymentRef,
  type NetworkGuardInput,
} from '../../lib/stellar/network-guard'
import { runNetworkGuardCli } from '../check-network-guard'
import { checkConvexDev } from '../convex-dev'
import { runLiveWindowCli } from '../live-window'
import {
  LIVE_WINDOW_FUNCTIONS,
  LIVE_WINDOW_LOG_ENV,
  LIVE_WINDOW_MAX_HOURS,
  LIVE_WINDOW_OPERATIONS,
  appendLiveWindowLog,
  envFilesAssigningApproval,
  evaluateLiveWindow,
  formatLiveWindowLogLine,
  liveWindowLogPath,
  parseLiveWindowApproval,
  readLiveWindowFacts,
  type LiveWindowFacts,
  type LiveWindowLogEntry,
} from '../lib/live-window'
import {
  assertScriptConvexDeployAllowed,
  assertScriptStellarTestnetOnly,
  assertScriptTestnetOnly,
  resolveScriptStellarNetwork,
} from '../lib/network-guard'
import {
  buildStellarCliCommand,
  runStellarCli,
  stellarCliNetworkArgs,
} from '../lib/stellar-cli'

const LIVE = 'upbeat-mockingbird-579'
const ALLOWED = 'efficient-tern-39'
const OTHER = 'quiet-test-123'

const SAFE: NetworkGuardInput = {
  operation: 'test operation',
  kind: 'operational',
  optIn: 'testnet',
  stellarNetworks: ['TESTNET'],
  networkPassphrase: TESTNET_PASSPHRASE,
  stellarUrls: [
    'https://horizon-testnet.stellar.org',
    'https://soroban-testnet.stellar.org',
  ],
  convexUrls: [`https://${ALLOWED}.convex.cloud`],
  convexDeployment: `dev:${ALLOWED}`,
}

const LIVE_TARGET: Partial<NetworkGuardInput> = {
  convexUrls: [`https://${LIVE}.convex.cloud`],
  convexDeployment: undefined,
}

function codesFor(overrides: Partial<NetworkGuardInput>) {
  return collectNetworkGuardRefusals({ ...SAFE, ...overrides }).map(
    (r) => r.code
  )
}

function guardError(fn: () => unknown): NetworkGuardError {
  try {
    fn()
  } catch (error) {
    if (error instanceof NetworkGuardError) return error
    throw error
  }
  throw new Error('expected NetworkGuardError')
}

describe('guard defaults', () => {
  it('passes for TESTNET, an allowlisted deployment, and the opt-in', () => {
    expect(collectNetworkGuardRefusals(SAFE)).toEqual([])
    expect(assertTestnetOnly(SAFE)).toEqual({
      network: 'TESTNET',
      convexDeployments: [ALLOWED],
      liveBackendApproved: false,
    })
  })

  it('allowlists the integration deployment and lists the live one', () => {
    expect(ALLOWED_CONVEX_DEPLOYMENTS).toContain(ALLOWED)
    expect(LIVE_CONVEX_DEPLOYMENTS).toContain(LIVE)
    expect(ALLOWED_CONVEX_DEPLOYMENTS).not.toContain(LIVE)
  })

  it('refuses without the explicit opt-in', () => {
    expect(codesFor({ optIn: undefined })).toEqual(['MISSING_OPT_IN'])
    expect(codesFor({ optIn: '1' })).toEqual(['OPT_IN_MISMATCH'])
    expect(codesFor({ optIn: 'TESTNET ' })).toEqual(['OPT_IN_MISMATCH'])
  })

  it('treats a missing kind as deploy, the stricter kind', () => {
    expect(
      codesFor({ ...LIVE_TARGET, kind: undefined, liveBackendApproval: LIVE })
    ).toEqual(['APPROVAL_NOT_FOR_DEPLOY', 'LIVE_BACKEND_DEPLOY'])
  })
})

describe('control 1: mainnet is always refused', () => {
  it('refuses when no Stellar network is set', () => {
    expect(codesFor({ stellarNetworks: [] })).toEqual(['MISSING_NETWORK'])
    expect(codesFor({ stellarNetworks: [undefined, ''] })).toEqual([
      'MISSING_NETWORK',
    ])
  })

  it('refuses a network other than TESTNET', () => {
    expect(codesFor({ stellarNetworks: ['MAINNET'] })).toEqual(['NOT_TESTNET'])
    expect(codesFor({ stellarNetworks: ['PUBLIC'] })).toEqual(['NOT_TESTNET'])
    expect(codesFor({ stellarNetworks: ['testnet'] })).toEqual(['NOT_TESTNET'])
  })

  it('refuses conflicting network values', () => {
    expect(codesFor({ stellarNetworks: ['TESTNET', 'MAINNET'] })).toEqual([
      'CONFLICTING_NETWORK',
      'NOT_TESTNET',
    ])
  })

  it('refuses the mainnet passphrase and unknown passphrases', () => {
    expect(codesFor({ networkPassphrase: MAINNET_PASSPHRASE })).toEqual([
      'MAINNET_PASSPHRASE',
    ])
    expect(
      codesFor({ networkPassphrase: 'Test SDF Future Network ; October 2022' })
    ).toEqual(['UNKNOWN_PASSPHRASE'])
  })

  it('refuses mainnet Horizon and RPC URLs', () => {
    expect(codesFor({ stellarUrls: ['https://horizon.stellar.org'] })).toEqual([
      'MAINNET_URL',
    ])
    expect(
      codesFor({ stellarUrls: ['https://mainnet.sorobanrpc.com'] })
    ).toEqual(['MAINNET_URL'])
    expect(
      codesFor({ stellarUrls: ['https://rpc-mainnet.provider.example'] })
    ).toEqual(['MAINNET_URL'])
  })

  it('refuses unknown endpoints and accepts local ones', () => {
    expect(codesFor({ stellarUrls: ['https://rpc.example.org'] })).toEqual([
      'UNTRUSTED_URL',
    ])
    expect(codesFor({ stellarUrls: ['not a url'] })).toEqual(['INVALID_URL'])
    expect(
      codesFor({ stellarUrls: ['http://localhost:8000/soroban/rpc'] })
    ).toEqual([])
  })

  it('has no override: the live backend approval does not unlock mainnet', () => {
    expect(
      codesFor({
        ...LIVE_TARGET,
        liveBackendApproval: LIVE,
        stellarNetworks: ['MAINNET'],
        networkPassphrase: MAINNET_PASSPHRASE,
        stellarUrls: ['https://horizon.stellar.org'],
      })
    ).toEqual(['NOT_TESTNET', 'MAINNET_PASSPHRASE', 'MAINNET_URL'])
  })

  it('has no override: an allowlisted backend does not unlock mainnet', () => {
    expect(codesFor({ stellarNetworks: ['MAINNET'] })).toEqual(['NOT_TESTNET'])
  })
})

describe('control 2: Convex backend allowlist', () => {
  it('refuses a missing Convex target', () => {
    expect(codesFor({ convexUrls: [], convexDeployment: undefined })).toEqual([
      'UNKNOWN_CONVEX',
    ])
  })

  it('refuses deployments that are not on the allowlist', () => {
    expect(
      codesFor({
        convexUrls: [`https://${OTHER}.convex.cloud`],
        convexDeployment: `dev:${OTHER}`,
      })
    ).toEqual(['CONVEX_NOT_ALLOWLISTED', 'CONVEX_NOT_ALLOWLISTED'])
    expect(codesFor({ convexUrls: ['https://api.example.org'] })).toEqual([
      'CONVEX_NOT_ALLOWLISTED',
    ])
  })

  it('accepts extra non-production deployments from the env allowlist', () => {
    expect(
      codesFor({
        convexUrls: [`https://${OTHER}.convex.cloud`],
        convexDeployment: `dev:${OTHER}`,
        extraAllowedDeployments: ` ${OTHER.toUpperCase()} `,
      })
    ).toEqual([])
  })

  it('refuses a live deployment in the env allowlist', () => {
    expect(codesFor({ extraAllowedDeployments: `${OTHER},${LIVE}` })).toEqual([
      'LIVE_IN_ALLOWLIST',
    ])
    expect(codesFor({ ...LIVE_TARGET, extraAllowedDeployments: LIVE })).toEqual(
      ['LIVE_IN_ALLOWLIST', 'LIVE_BACKEND_NOT_APPROVED']
    )
  })

  it('accepts local backends', () => {
    expect(
      codesFor({
        convexUrls: ['http://127.0.0.1:3210'],
        convexDeployment: 'anonymous:anonymous-agent',
      })
    ).toEqual([])
    expect(
      codesFor({
        kind: 'deploy',
        convexUrls: [],
        convexDeployment: 'local:local-team-quilltip',
      })
    ).toEqual([])
  })

  it('refuses production-type deployments and deploy keys', () => {
    expect(codesFor({ convexDeployment: `prod:${ALLOWED}` })).toEqual([
      'PROD_CONVEX_TYPE',
    ])
    expect(codesFor({ convexDeployKey: `prod:${ALLOWED}|secret` })).toEqual([
      'PROD_CONVEX_TYPE',
    ])
  })

  it('never prints deploy key secrets', () => {
    const error = guardError(() =>
      assertTestnetOnly({ ...SAFE, convexDeployKey: 'prod:x|super-secret' })
    )
    expect(error.message).not.toContain('super-secret')
  })

  it('treats extra production names as live', () => {
    expect(
      codesFor({
        convexUrls: [`https://${OTHER}.convex.cloud`],
        convexDeployment: undefined,
        extraAllowedDeployments: OTHER,
        extraProductionDeployments: OTHER,
      })
    ).toEqual(['LIVE_IN_ALLOWLIST', 'LIVE_BACKEND_NOT_APPROVED'])
  })
})

describe('control 2: live backend approval', () => {
  it('refuses the live backend by default for operational runs', () => {
    expect(codesFor(LIVE_TARGET)).toEqual(['LIVE_BACKEND_NOT_APPROVED'])
    expect(
      codesFor({ convexUrls: [], convexDeployment: `dev:${LIVE}` })
    ).toEqual(['LIVE_BACKEND_NOT_APPROVED'])
  })

  it('allows an operational run that names the live deployment', () => {
    expect(codesFor({ ...LIVE_TARGET, liveBackendApproval: LIVE })).toEqual([])
    expect(
      assertTestnetOnly({ ...SAFE, ...LIVE_TARGET, liveBackendApproval: LIVE })
    ).toEqual({
      network: 'TESTNET',
      convexDeployments: [LIVE],
      liveBackendApproved: true,
    })
  })

  it('refuses an approval value that is not a live deployment', () => {
    expect(codesFor({ ...LIVE_TARGET, liveBackendApproval: 'yes' })).toEqual([
      'INVALID_APPROVAL',
      'LIVE_BACKEND_NOT_APPROVED',
    ])
    expect(codesFor({ liveBackendApproval: ALLOWED })).toEqual([
      'INVALID_APPROVAL',
    ])
  })

  it('refuses deploy-kind work on the live backend, approved or not', () => {
    expect(codesFor({ ...LIVE_TARGET, kind: 'deploy' })).toEqual([
      'LIVE_BACKEND_DEPLOY',
    ])
    expect(
      codesFor({ ...LIVE_TARGET, kind: 'deploy', liveBackendApproval: LIVE })
    ).toEqual(['APPROVAL_NOT_FOR_DEPLOY', 'LIVE_BACKEND_DEPLOY'])
    expect(
      codesFor({
        kind: 'deploy',
        convexUrls: [],
        convexDeployment: `dev:${LIVE}`,
        convexDeployKey: `dev:${LIVE}|secret`,
      })
    ).toEqual(['LIVE_BACKEND_DEPLOY', 'LIVE_BACKEND_DEPLOY'])
  })

  it('refuses the approval variable on any deploy-kind run', () => {
    expect(codesFor({ kind: 'deploy', liveBackendApproval: LIVE })).toEqual([
      'APPROVAL_NOT_FOR_DEPLOY',
    ])
  })

  it('reports every refusal in one error', () => {
    const error = guardError(() =>
      assertTestnetOnly({
        operation: 'combined',
        kind: 'deploy',
        stellarNetworks: ['MAINNET'],
        networkPassphrase: MAINNET_PASSPHRASE,
        stellarUrls: ['https://horizon.stellar.org'],
        convexUrls: [`https://${LIVE}.convex.cloud`],
      })
    )
    expect(error.codes).toEqual([
      'MISSING_OPT_IN',
      'NOT_TESTNET',
      'MAINNET_PASSPHRASE',
      'MAINNET_URL',
      'LIVE_BACKEND_DEPLOY',
    ])
    expect(error.message).toContain('Network guard refused "combined"')
  })
})

describe('Convex helpers', () => {
  it('reads deployment names from Convex URLs', () => {
    expect(convexDeploymentNameFromUrl(`https://${LIVE}.convex.cloud`)).toBe(
      LIVE
    )
    expect(
      convexDeploymentNameFromUrl('https://name-1.eu-west-1.convex.cloud')
    ).toBe('name-1')
    expect(convexDeploymentNameFromUrl('http://127.0.0.1:3210')).toBeNull()
    expect(convexDeploymentNameFromUrl('nope')).toBeNull()
  })

  it('parses deployment references', () => {
    expect(parseConvexDeploymentRef('dev:a-b-1')).toEqual({
      type: 'dev',
      name: 'a-b-1',
    })
    expect(parseConvexDeploymentRef('a-b-1')).toEqual({
      type: null,
      name: 'a-b-1',
    })
  })
})

describe('backend guards', () => {
  it('allows TESTNET and an unset network', () => {
    expect(assertBackendTestnet({ STELLAR_NETWORK: 'TESTNET' })).toBe('TESTNET')
    expect(assertBackendTestnet({})).toBe('TESTNET')
  })

  it('allows a custom testnet Horizon provider', () => {
    expect(
      assertBackendTestnet({ HORIZON_URL: 'https://horizon.example.org' })
    ).toBe('TESTNET')
  })

  it('refuses MAINNET and mainnet Horizon on the backend', () => {
    expect(
      guardError(() => assertBackendTestnet({ STELLAR_NETWORK: 'MAINNET' }))
        .codes
    ).toEqual(['NOT_TESTNET'])
    expect(
      guardError(() =>
        assertBackendTestnet({ HORIZON_URL: 'https://horizon.stellar.org' })
      ).codes
    ).toEqual(['MAINNET_URL'])
  })

  it('refuses maintenance functions on the live deployment', () => {
    expect(
      guardError(() =>
        assertNonProductionBackend('seed', {
          CONVEX_CLOUD_URL: `https://${LIVE}.convex.cloud`,
        })
      ).codes
    ).toEqual(['LIVE_BACKEND_DEPLOY'])
  })

  it('refuses maintenance functions on unknown or unlisted deployments', () => {
    expect(
      guardError(() => assertNonProductionBackend('seed', {})).codes
    ).toEqual(['UNKNOWN_CONVEX'])
    expect(
      guardError(() =>
        assertNonProductionBackend('seed', {
          CONVEX_CLOUD_URL: `https://${OTHER}.convex.cloud`,
        })
      ).codes
    ).toEqual(['CONVEX_NOT_ALLOWLISTED'])
  })

  it('allows maintenance functions on an allowlisted deployment', () => {
    expect(() =>
      assertNonProductionBackend('seed', {
        CONVEX_CLOUD_URL: `https://${ALLOWED}.convex.cloud`,
      })
    ).not.toThrow()
  })
})

const SCRIPT_ENV = {
  [NETWORK_GUARD_OPT_IN_ENV]: 'testnet',
  NEXT_PUBLIC_STELLAR_NETWORK: 'TESTNET',
  NEXT_PUBLIC_NETWORK_PASSPHRASE: TESTNET_PASSPHRASE,
  NEXT_PUBLIC_HORIZON_URL: 'https://horizon-testnet.stellar.org',
  NEXT_PUBLIC_SOROBAN_RPC_URL: 'https://soroban-testnet.stellar.org',
  NEXT_PUBLIC_CONVEX_URL: `https://${ALLOWED}.convex.cloud`,
  CONVEX_DEPLOYMENT: `dev:${ALLOWED}`,
}

const LIVE_SCRIPT_ENV = {
  ...SCRIPT_ENV,
  NEXT_PUBLIC_CONVEX_URL: `https://${LIVE}.convex.cloud`,
  CONVEX_DEPLOYMENT: `dev:${LIVE}`,
}

describe('script guard', () => {
  it('passes for a testnet script environment', () => {
    expect(assertScriptTestnetOnly('script', SCRIPT_ENV).network).toBe(
      'TESTNET'
    )
  })

  it('refuses when NEXT_PUBLIC and backend networks disagree', () => {
    expect(
      guardError(() =>
        assertScriptTestnetOnly('script', {
          ...SCRIPT_ENV,
          STELLAR_NETWORK: 'MAINNET',
        })
      ).codes
    ).toEqual(['CONFLICTING_NETWORK', 'NOT_TESTNET'])
  })

  it('refuses a live Convex URL from any env var', () => {
    for (const key of [
      'NEXT_PUBLIC_CONVEX_URL',
      'CONVEX_URL',
      'CONVEX_SELF_HOSTED_URL',
    ]) {
      expect(
        guardError(() =>
          assertScriptTestnetOnly('script', {
            ...SCRIPT_ENV,
            [key]: `https://${LIVE}.convex.cloud`,
          })
        ).codes
      ).toContain('LIVE_BACKEND_NOT_APPROVED')
    }
  })

  it('lets an approved operational script target the live backend', () => {
    expect(
      assertScriptTestnetOnly('operational run', {
        ...LIVE_SCRIPT_ENV,
        [LIVE_BACKEND_APPROVAL_ENV]: LIVE,
      }).liveBackendApproved
    ).toBe(true)
  })

  it('never lets deploy tooling target the live backend', () => {
    expect(
      guardError(() =>
        assertScriptConvexDeployAllowed('push', {
          ...LIVE_SCRIPT_ENV,
          [LIVE_BACKEND_APPROVAL_ENV]: LIVE,
        })
      ).codes
    ).toEqual([
      'APPROVAL_NOT_FOR_DEPLOY',
      'LIVE_BACKEND_DEPLOY',
      'LIVE_BACKEND_DEPLOY',
    ])
  })

  it('requires a Convex target for deploy tooling', () => {
    expect(
      guardError(() =>
        assertScriptConvexDeployAllowed('push', {
          [NETWORK_GUARD_OPT_IN_ENV]: 'testnet',
        })
      ).codes
    ).toEqual(['UNKNOWN_CONVEX'])
    expect(
      assertScriptConvexDeployAllowed('push', {
        [NETWORK_GUARD_OPT_IN_ENV]: 'testnet',
        CONVEX_DEPLOYMENT: `dev:${ALLOWED}`,
      }).convexDeployments
    ).toEqual([ALLOWED])
  })
})

describe('guard CLI', () => {
  afterEach(() => vi.restoreAllMocks())

  it('exits 0 when the guard passes', () => {
    vi.spyOn(console, 'log').mockImplementation(() => {})
    expect(runNetworkGuardCli([], SCRIPT_ENV)).toBe(0)
    expect(runNetworkGuardCli(['--convex'], SCRIPT_ENV)).toBe(0)
  })

  it('warns when an approved operational run targets the live backend', () => {
    vi.spyOn(console, 'log').mockImplementation(() => {})
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(
      runNetworkGuardCli([], {
        ...LIVE_SCRIPT_ENV,
        [LIVE_BACKEND_APPROVAL_ENV]: LIVE,
      })
    ).toBe(0)
    expect(String(warn.mock.calls[0]?.[0])).toContain('live backend')
  })

  it('exits 1 for a live deploy even with the approval', () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(
      runNetworkGuardCli(['--convex'], {
        ...LIVE_SCRIPT_ENV,
        [LIVE_BACKEND_APPROVAL_ENV]: LIVE,
      })
    ).toBe(1)
    expect(String(errors.mock.calls[0]?.[0])).toContain('LIVE_BACKEND_DEPLOY')
  })
})

// ---------------------------------------------------------------------------
// v2 chain variables: RPC URL and network passphrase
// ---------------------------------------------------------------------------

const TESTNET_RPC = 'https://soroban-testnet.stellar.org'

const V2_SCRIPT_ENV = {
  [NETWORK_GUARD_OPT_IN_ENV]: 'testnet',
  NEXT_PUBLIC_STELLAR_NETWORK: 'TESTNET',
  STELLAR_NETWORK: 'TESTNET',
  CONVEX_DEPLOYMENT: `dev:${ALLOWED}`,
  NEXT_PUBLIC_CONVEX_URL: `https://${ALLOWED}.convex.cloud`,
}

const RPC_VARIABLES = [
  'STELLAR_RPC_URL',
  'NEXT_PUBLIC_STELLAR_RPC_URL',
  'NEXT_PUBLIC_SOROBAN_RPC_URL',
] as const

const PASSPHRASE_VARIABLES = [
  'NETWORK_PASSPHRASE',
  'NEXT_PUBLIC_NETWORK_PASSPHRASE',
] as const

const MAINNET_RPC_FORMS = [
  'https://mainnet.sorobanrpc.com',
  'HTTPS://MAINNET.SOROBANRPC.COM/',
  'https://Mainnet.SorobanRpc.com:443/rpc?x=1',
  'https://mainnet.sorobanrpc.com.',
  'https://user:secret@soroban-rpc.mainnet.stellar.gateway.fm',
  'https://soroban-testnet.stellar.org@mainnet.sorobanrpc.com',
  'https://horizon.stellar.org',
  'https://HORIZON.stellar.ORG./',
  'https://rpc-mainnet.example.org',
  'https://ｍａｉｎｎｅｔ.sorobanrpc.com',
]

const MAINNET_PASSPHRASE_FORMS = [
  MAINNET_PASSPHRASE,
  MAINNET_PASSPHRASE.toUpperCase(),
  MAINNET_PASSPHRASE.toLowerCase(),
  `  ${MAINNET_PASSPHRASE}\n`,
  MAINNET_PASSPHRASE.replace(/ /g, '  '),
  'Ｐｕｂｌｉｃ Global Stellar Network ; September 2015',
]

const UNKNOWN_PASSPHRASES = [
  'Test SDF Future Network ; October 2022',
  'Local Sandbox Stellar Network ; September 2022',
  `${TESTNET_PASSPHRASE}.`,
  TESTNET_PASSPHRASE.toLowerCase(),
  'anything else',
]

describe('v2 RPC URL variables', () => {
  it.each(RPC_VARIABLES)('accepts the testnet RPC in %s', (name) => {
    expect(
      assertScriptTestnetOnly('rpc', { ...V2_SCRIPT_ENV, [name]: TESTNET_RPC })
        .network
    ).toBe('TESTNET')
  })

  for (const name of RPC_VARIABLES) {
    it.each(MAINNET_RPC_FORMS)(`refuses mainnet host in ${name}: %s`, (url) => {
      expect(
        guardError(() =>
          assertScriptTestnetOnly('rpc', { ...V2_SCRIPT_ENV, [name]: url })
        ).codes
      ).toEqual(['MAINNET_URL'])
    })

    it.each([
      'https://rpc.example.org',
      'https://soroban-testnet.stellar.org.evil.example',
      'https://soroban-testnet.stellar.org.',
      'https://testnet.sorobanrpc.com',
    ])(`refuses RPC host outside the allowlist in ${name}: %s`, (url) => {
      expect(
        guardError(() =>
          assertScriptTestnetOnly('rpc', { ...V2_SCRIPT_ENV, [name]: url })
        ).codes
      ).toEqual(['UNTRUSTED_URL'])
    })

    it.each(['not a url', 'ftp://soroban-testnet.stellar.org'])(
      `refuses an invalid RPC URL in ${name}: %s`,
      (url) => {
        expect(
          guardError(() =>
            assertScriptTestnetOnly('rpc', { ...V2_SCRIPT_ENV, [name]: url })
          ).codes
        ).toEqual(['INVALID_URL'])
      }
    )
  }

  it('resolves the RPC URL from STELLAR_RPC_URL first, then the client names', () => {
    const custom = 'http://127.0.0.1:8000/soroban/rpc'
    expect(
      resolveScriptStellarNetwork('rpc', {
        ...V2_SCRIPT_ENV,
        STELLAR_RPC_URL: custom,
        NEXT_PUBLIC_STELLAR_RPC_URL: TESTNET_RPC,
      }).rpcUrl
    ).toBe(custom)
    expect(
      resolveScriptStellarNetwork('rpc', {
        ...V2_SCRIPT_ENV,
        NEXT_PUBLIC_SOROBAN_RPC_URL: TESTNET_RPC,
      }).rpcUrl
    ).toBe(TESTNET_RPC)
    expect(resolveScriptStellarNetwork('rpc', V2_SCRIPT_ENV).rpcUrl).toBe(
      TESTNET_RPC
    )
  })

  it('refuses different values in the current and earlier client RPC names', () => {
    expect(() =>
      resolveScriptStellarNetwork('rpc', {
        ...V2_SCRIPT_ENV,
        NEXT_PUBLIC_STELLAR_RPC_URL: TESTNET_RPC,
        NEXT_PUBLIC_SOROBAN_RPC_URL: 'http://localhost:8000/soroban/rpc',
      })
    ).toThrow(StellarNetworkConfigError)
  })
})

describe('v2 network passphrase variables', () => {
  it.each(PASSPHRASE_VARIABLES)(
    'accepts the testnet passphrase in %s',
    (name) => {
      expect(
        resolveScriptStellarNetwork('passphrase', {
          ...V2_SCRIPT_ENV,
          [name]: TESTNET_PASSPHRASE,
        }).passphrase
      ).toBe(TESTNET_PASSPHRASE)
    }
  )

  for (const name of PASSPHRASE_VARIABLES) {
    it.each(MAINNET_PASSPHRASE_FORMS)(
      `refuses the mainnet passphrase in ${name}: %j`,
      (passphrase) => {
        expect(
          guardError(() =>
            assertScriptTestnetOnly('passphrase', {
              ...V2_SCRIPT_ENV,
              [name]: passphrase,
            })
          ).codes
        ).toEqual(['MAINNET_PASSPHRASE'])
      }
    )

    it.each([...UNKNOWN_PASSPHRASES, LOCAL_PASSPHRASE])(
      `refuses an unknown passphrase in ${name} on TESTNET: %j`,
      (passphrase) => {
        expect(
          guardError(() =>
            assertScriptTestnetOnly('passphrase', {
              ...V2_SCRIPT_ENV,
              [name]: passphrase,
            })
          ).codes
        ).toEqual(['UNKNOWN_PASSPHRASE'])
      }
    )
  }

  it('refuses passphrase variables that disagree', () => {
    expect(
      guardError(() =>
        assertScriptTestnetOnly('passphrase', {
          ...V2_SCRIPT_ENV,
          NETWORK_PASSPHRASE: TESTNET_PASSPHRASE,
          NEXT_PUBLIC_NETWORK_PASSPHRASE: MAINNET_PASSPHRASE,
        })
      ).codes
    ).toEqual(['CONFLICTING_PASSPHRASE', 'MAINNET_PASSPHRASE'])
  })
})

describe('backend checks read the v2 variables', () => {
  it('accepts the testnet passphrase and RPC, and a custom testnet RPC provider', () => {
    expect(
      assertBackendTestnet({
        STELLAR_NETWORK: 'TESTNET',
        NETWORK_PASSPHRASE: TESTNET_PASSPHRASE,
        STELLAR_RPC_URL: TESTNET_RPC,
      })
    ).toBe('TESTNET')
    expect(
      assertBackendTestnet({ STELLAR_RPC_URL: 'https://rpc.example.org' })
    ).toBe('TESTNET')
  })

  it.each(MAINNET_PASSPHRASE_FORMS)(
    'refuses NETWORK_PASSPHRASE %j on the backend',
    (passphrase) => {
      expect(
        guardError(() =>
          assertBackendTestnet({ NETWORK_PASSPHRASE: passphrase })
        ).codes
      ).toEqual(['MAINNET_PASSPHRASE'])
    }
  )

  it.each(UNKNOWN_PASSPHRASES)(
    'refuses an unknown NETWORK_PASSPHRASE %j on the backend',
    (passphrase) => {
      expect(
        guardError(() =>
          assertBackendTestnet({ NETWORK_PASSPHRASE: passphrase })
        ).codes
      ).toEqual(['UNKNOWN_PASSPHRASE'])
    }
  )

  it.each(MAINNET_RPC_FORMS)(
    'refuses STELLAR_RPC_URL %s on the backend',
    (url) => {
      expect(
        guardError(() => assertBackendTestnet({ STELLAR_RPC_URL: url })).codes
      ).toEqual(['MAINNET_URL'])
    }
  )

  it('applies the same checks to maintenance functions', () => {
    const base = { CONVEX_CLOUD_URL: `https://${ALLOWED}.convex.cloud` }
    expect(
      guardError(() =>
        assertNonProductionBackend('seed', {
          ...base,
          NETWORK_PASSPHRASE: MAINNET_PASSPHRASE,
        })
      ).codes
    ).toEqual(['MAINNET_PASSPHRASE'])
    expect(
      guardError(() =>
        assertNonProductionBackend('seed', {
          ...base,
          STELLAR_RPC_URL: 'https://mainnet.sorobanrpc.com',
        })
      ).codes
    ).toEqual(['MAINNET_URL'])
  })
})

// ---------------------------------------------------------------------------
// LOCAL mode
// ---------------------------------------------------------------------------

const LOCAL_RPC = 'http://localhost:8000/soroban/rpc'
const LOCAL_CONVEX = 'http://127.0.0.1:3210'

const LOCAL_ENV = {
  [NETWORK_GUARD_OPT_IN_ENV]: 'local',
  NEXT_PUBLIC_STELLAR_NETWORK: 'LOCAL',
  STELLAR_NETWORK: 'LOCAL',
  NETWORK_PASSPHRASE: LOCAL_PASSPHRASE,
  STELLAR_RPC_URL: LOCAL_RPC,
  CONVEX_DEPLOYMENT: 'anonymous:anonymous-quilltip',
  NEXT_PUBLIC_CONVEX_URL: LOCAL_CONVEX,
}

const LOCAL_INPUT: NetworkGuardInput = {
  operation: 'local test',
  kind: 'operational',
  optIn: 'local',
  stellarNetworks: ['LOCAL'],
  networkPassphrases: [LOCAL_PASSPHRASE],
  stellarUrls: [LOCAL_RPC],
  convexUrls: [LOCAL_CONVEX],
}

function localCodes(overrides: Partial<NetworkGuardInput>) {
  return collectNetworkGuardRefusals({ ...LOCAL_INPUT, ...overrides }).map(
    (r) => r.code
  )
}

describe('LOCAL mode', () => {
  it('passes with the local opt-in, standalone passphrase, local RPC, and local backend', () => {
    expect(assertTestnetOnly(LOCAL_INPUT)).toEqual({
      network: 'LOCAL',
      convexDeployments: [],
      liveBackendApproved: false,
    })
    expect(assertScriptTestnetOnly('local', LOCAL_ENV).network).toBe('LOCAL')
    expect(
      localCodes({ stellarUrls: ['http://127.0.0.1:8000/soroban/rpc'] })
    ).toEqual([])
    expect(
      localCodes({ convexUrls: [], convexDeployment: 'local:local-quilltip' })
    ).toEqual([])
  })

  it('requires QUILLTIP_NETWORK_GUARD_OPT_IN=local', () => {
    expect(localCodes({ optIn: undefined })).toEqual(['MISSING_OPT_IN'])
    expect(localCodes({ optIn: 'testnet' })).toEqual(['OPT_IN_MISMATCH'])
    expect(localCodes({ optIn: 'LOCAL' })).toEqual(['OPT_IN_MISMATCH'])
  })

  it('does not accept the local opt-in for TESTNET', () => {
    expect(codesFor({ optIn: 'local' })).toEqual(['OPT_IN_MISMATCH'])
  })

  it('refuses a Convex cloud target, allowlisted or not', () => {
    expect(
      localCodes({ convexUrls: [`https://${ALLOWED}.convex.cloud`] })
    ).toEqual(['LOCAL_CLOUD_CONVEX'])
    expect(localCodes({ convexDeployment: `dev:${ALLOWED}` })).toEqual([
      'LOCAL_CLOUD_CONVEX',
    ])
    expect(
      localCodes({ convexDeployKey: `preview:${ALLOWED}|opaque` })
    ).toEqual(['LOCAL_CLOUD_CONVEX'])
    expect(
      localCodes({ convexUrls: [LOCAL_CONVEX, 'https://backend.example.org'] })
    ).toEqual(['LOCAL_CLOUD_CONVEX'])
    expect(
      guardError(() =>
        assertScriptTestnetOnly('local', {
          ...LOCAL_ENV,
          NEXT_PUBLIC_CONVEX_URL: `https://${ALLOWED}.convex.cloud`,
        })
      ).codes
    ).toEqual(['LOCAL_CLOUD_CONVEX'])
  })

  it('refuses the live backend in LOCAL mode', () => {
    expect(
      localCodes({ convexUrls: [`https://${LIVE}.convex.cloud`] })
    ).toEqual(['LOCAL_CLOUD_CONVEX', 'LIVE_BACKEND_NOT_APPROVED'])
  })

  it('refuses LOCAL with no Convex target', () => {
    expect(localCodes({ convexUrls: [] })).toEqual(['UNKNOWN_CONVEX'])
  })

  it('refuses the live backend approval variable in LOCAL mode', () => {
    expect(localCodes({ liveBackendApproval: LIVE })).toEqual([
      'LOCAL_LIVE_APPROVAL',
    ])
    const error = guardError(() =>
      assertTestnetOnly({
        ...LOCAL_INPUT,
        convexUrls: [`https://${LIVE}.convex.cloud`],
        liveBackendApproval: LIVE,
      })
    )
    expect(error.codes).toEqual([
      'LOCAL_LIVE_APPROVAL',
      'LOCAL_CLOUD_CONVEX',
      'LIVE_BACKEND_NOT_APPROVED',
    ])
    expect(
      guardError(() =>
        assertScriptTestnetOnly('local', {
          ...LOCAL_ENV,
          [LIVE_BACKEND_APPROVAL_ENV]: LIVE,
        })
      ).codes
    ).toEqual(['LOCAL_LIVE_APPROVAL'])
  })

  it('accepts only the standalone passphrase', () => {
    expect(localCodes({ networkPassphrases: [TESTNET_PASSPHRASE] })).toEqual([
      'UNKNOWN_PASSPHRASE',
    ])
    for (const passphrase of UNKNOWN_PASSPHRASES) {
      expect(localCodes({ networkPassphrases: [passphrase] })).toEqual([
        'UNKNOWN_PASSPHRASE',
      ])
    }
    for (const passphrase of MAINNET_PASSPHRASE_FORMS) {
      expect(localCodes({ networkPassphrases: [passphrase] })).toEqual([
        'MAINNET_PASSPHRASE',
      ])
    }
  })

  it('accepts only localhost and 127.0.0.1 endpoints', () => {
    for (const url of [
      TESTNET_RPC,
      'https://horizon-testnet.stellar.org',
      'http://[::1]:8000/soroban/rpc',
      'http://127.0.0.2:8000',
      'http://0.0.0.0:8000',
      'http://localhost.example.org:8000',
      'http://localhost@rpc.example.org',
      'http://127.0.0.1.nip.io:8000',
    ]) {
      expect(localCodes({ stellarUrls: [url] })).toEqual(['LOCAL_REMOTE_URL'])
    }
    for (const url of MAINNET_RPC_FORMS) {
      expect(localCodes({ stellarUrls: [url] })).toEqual(['MAINNET_URL'])
    }
  })

  it('refuses LOCAL mixed with TESTNET', () => {
    expect(localCodes({ stellarNetworks: ['LOCAL', 'TESTNET'] })).toContain(
      'CONFLICTING_NETWORK'
    )
  })

  it('lets deploy tooling target a local backend only', () => {
    expect(
      assertScriptConvexDeployAllowed('push', {
        [NETWORK_GUARD_OPT_IN_ENV]: 'local',
        CONVEX_DEPLOYMENT: 'anonymous:anonymous-quilltip',
      }).network
    ).toBe('LOCAL')
    expect(
      guardError(() =>
        assertScriptConvexDeployAllowed('push', {
          [NETWORK_GUARD_OPT_IN_ENV]: 'local',
          CONVEX_DEPLOYMENT: `dev:${ALLOWED}`,
        })
      ).codes
    ).toEqual(['LOCAL_CLOUD_CONVEX'])
  })

  it('reports LOCAL from the guard CLI', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    expect(runNetworkGuardCli([], LOCAL_ENV)).toBe(0)
    expect(String(log.mock.calls[0]?.[0])).toContain('Stellar: LOCAL')
    log.mockRestore()
  })
})

describe('LOCAL mode runtime checks', () => {
  const BACKEND_LOCAL = {
    STELLAR_NETWORK: 'LOCAL',
    [NETWORK_GUARD_OPT_IN_ENV]: 'local',
    NETWORK_PASSPHRASE: LOCAL_PASSPHRASE,
    STELLAR_RPC_URL: LOCAL_RPC,
    CONVEX_CLOUD_URL: LOCAL_CONVEX,
  }

  it('accepts a local backend in LOCAL mode', () => {
    expect(assertBackendNetwork(BACKEND_LOCAL)).toBe('LOCAL')
    expect(() =>
      assertNonProductionBackend('seed', BACKEND_LOCAL)
    ).not.toThrow()
  })

  it('refuses LOCAL on a Convex cloud deployment', () => {
    expect(
      guardError(() =>
        assertBackendNetwork({
          ...BACKEND_LOCAL,
          CONVEX_CLOUD_URL: `https://${ALLOWED}.convex.cloud`,
        })
      ).codes
    ).toEqual(['LOCAL_CLOUD_CONVEX'])
    expect(
      guardError(() =>
        assertBackendNetwork({ ...BACKEND_LOCAL, CONVEX_CLOUD_URL: undefined })
      ).codes
    ).toEqual(['UNKNOWN_CONVEX'])
    expect(
      guardError(() =>
        assertNonProductionBackend('seed', {
          ...BACKEND_LOCAL,
          CONVEX_CLOUD_URL: `https://${ALLOWED}.convex.cloud`,
        })
      ).codes
    ).toEqual(['LOCAL_CLOUD_CONVEX'])
  })

  it('requires the local opt-in on the backend', () => {
    expect(
      guardError(() =>
        assertBackendNetwork({
          ...BACKEND_LOCAL,
          [NETWORK_GUARD_OPT_IN_ENV]: undefined,
        })
      ).codes
    ).toEqual(['MISSING_OPT_IN'])
  })

  it('refuses remote RPC and other passphrases on a LOCAL backend', () => {
    expect(
      guardError(() =>
        assertBackendNetwork({ ...BACKEND_LOCAL, STELLAR_RPC_URL: TESTNET_RPC })
      ).codes
    ).toEqual(['LOCAL_REMOTE_URL'])
    expect(
      guardError(() =>
        assertBackendNetwork({
          ...BACKEND_LOCAL,
          NETWORK_PASSPHRASE: MAINNET_PASSPHRASE,
        })
      ).codes
    ).toEqual(['MAINNET_PASSPHRASE'])
  })

  it('keeps TESTNET payment flows off a LOCAL backend', () => {
    expect(guardError(() => assertBackendTestnet(BACKEND_LOCAL)).codes).toEqual(
      ['NOT_TESTNET']
    )
  })

  it('accepts a LOCAL client only with a local Convex URL', () => {
    const client = {
      network: 'LOCAL',
      passphrase: LOCAL_PASSPHRASE,
      horizonUrl: 'http://localhost:8000',
      rpcUrl: LOCAL_RPC,
    }
    expect(assertClientNetwork({ ...client, convexUrl: LOCAL_CONVEX })).toBe(
      'LOCAL'
    )
    expect(
      guardError(() =>
        assertClientNetwork({
          ...client,
          convexUrl: `https://${ALLOWED}.convex.cloud`,
        })
      ).codes
    ).toEqual(['LOCAL_CLOUD_CONVEX'])
    expect(guardError(() => assertClientNetwork(client)).codes).toEqual([
      'UNKNOWN_CONVEX',
    ])
    expect(
      guardError(() =>
        assertClientNetwork({
          ...client,
          rpcUrl: 'https://rpc.example.org',
          convexUrl: LOCAL_CONVEX,
        })
      ).codes
    ).toEqual(['LOCAL_REMOTE_URL'])
  })
})

// ---------------------------------------------------------------------------
// Stellar CLI wrapper
// ---------------------------------------------------------------------------

describe('Stellar CLI wrapper', () => {
  it('passes the testnet network, RPC URL, and passphrase explicitly', () => {
    const built = buildStellarCliCommand(
      'deploy',
      ['contract', 'deploy', '--wasm', 'core.wasm'],
      V2_SCRIPT_ENV
    )
    expect(built.args).toEqual([
      'contract',
      'deploy',
      '--wasm',
      'core.wasm',
      '--network',
      'testnet',
      '--rpc-url',
      TESTNET_RPC,
      '--network-passphrase',
      TESTNET_PASSPHRASE,
    ])
    expect(built.network).toBe('TESTNET')
    expect(built.env.STELLAR_RPC_URL).toBe(TESTNET_RPC)
    expect(built.env.STELLAR_NETWORK_PASSPHRASE).toBe(TESTNET_PASSPHRASE)
  })

  it('passes the local network, RPC URL, and standalone passphrase in LOCAL mode', () => {
    expect(stellarCliNetworkArgs('deploy', LOCAL_ENV)).toEqual([
      '--network',
      'local',
      '--rpc-url',
      LOCAL_RPC,
      '--network-passphrase',
      LOCAL_PASSPHRASE,
    ])
  })

  it('uses a configured testnet RPC provider', () => {
    expect(
      stellarCliNetworkArgs('deploy', {
        ...V2_SCRIPT_ENV,
        NEXT_PUBLIC_STELLAR_RPC_URL: 'http://localhost:9000/rpc',
      })
    ).toContain('http://localhost:9000/rpc')
  })

  it.each([
    ['--network', 'mainnet'],
    ['--network=mainnet'],
    ['--rpc-url', 'https://mainnet.sorobanrpc.com'],
    ['--rpc-url=https://mainnet.sorobanrpc.com'],
    ['--network-passphrase', MAINNET_PASSPHRASE],
    ['-n', 'mainnet'],
  ])('refuses caller network flags %j without printing values', (...flags) => {
    const error = guardError(() =>
      buildStellarCliCommand(
        'deploy',
        ['contract', 'deploy', ...flags],
        V2_SCRIPT_ENV
      )
    )
    expect(error.codes).toEqual(['CLI_NETWORK_FLAG'])
    expect(error.message).not.toContain('sorobanrpc')
    expect(error.message).not.toContain('Public Global')
  })

  it('runs the guard before building or running a command', () => {
    const spawn = vi.fn()
    expect(
      guardError(() =>
        runStellarCli('deploy', ['contract', 'deploy'], {
          env: { ...V2_SCRIPT_ENV, NETWORK_PASSPHRASE: MAINNET_PASSPHRASE },
          spawn,
        })
      ).codes
    ).toEqual(['MAINNET_PASSPHRASE'])
    expect(
      guardError(() =>
        runStellarCli('deploy', ['contract', 'deploy'], {
          env: { ...LOCAL_ENV, CONVEX_DEPLOYMENT: `dev:${ALLOWED}` },
          spawn,
        })
      ).codes
    ).toEqual(['LOCAL_CLOUD_CONVEX'])
    expect(spawn).not.toHaveBeenCalled()
  })

  it('runs the stellar binary with guarded arguments and env', () => {
    const spawn = vi.fn(() => ({ status: 0 }) as never)
    runStellarCli('version', ['--version'], {
      env: {
        ...V2_SCRIPT_ENV,
        SOROBAN_RPC_URL: 'https://mainnet.sorobanrpc.com',
      },
      spawn,
    })
    expect(spawn).toHaveBeenCalledTimes(1)
    const [command, args, options] = spawn.mock.calls[0] as unknown as [
      string,
      string[],
      { env: Record<string, string | undefined> },
    ]
    expect(command).toBe('stellar')
    expect(args.slice(-6)).toEqual([
      '--network',
      'testnet',
      '--rpc-url',
      TESTNET_RPC,
      '--network-passphrase',
      TESTNET_PASSPHRASE,
    ])
    expect(options.env.SOROBAN_RPC_URL).toBeUndefined()
    expect(options.env.STELLAR_NETWORK).toBe('testnet')
  })
})

// ---------------------------------------------------------------------------
// Maintenance-window approval (scripts/lib/live-window.ts)
// ---------------------------------------------------------------------------

const RELEASE = '3f2c9a1b7d4e5f60718293a4b5c6d7e8f9012345'
const CHECKOUT = '/work/quilltip-release'
const WINDOW_NOW = new Date('2026-12-15T03:00:00Z')
const WINDOW_VALUE = `${LIVE}@${RELEASE}@2026-12-15T02:00Z+3h`
const DEPLOY_KEY = `dev:${LIVE}|key-material-that-must-not-leak`

const WINDOW_ENV: Record<string, string | undefined> = {
  [NETWORK_GUARD_OPT_IN_ENV]: 'testnet',
  NEXT_PUBLIC_STELLAR_NETWORK: 'TESTNET',
  CONVEX_DEPLOY_KEY: DEPLOY_KEY,
  [LIVE_WINDOW_APPROVAL_ENV]: WINDOW_VALUE,
}

const WINDOW_FACTS: LiveWindowFacts = {
  now: WINDOW_NOW,
  head: RELEASE,
  dirty: false,
  checkoutRoot: CHECKOUT,
  cwdRoot: CHECKOUT,
  envFileHits: [],
  committedHits: [],
}

const EXISTING_RESTORE = '/backups/restore.zip'
const fileExists = (file: string) => file === EXISTING_RESTORE

function windowCodes(
  args: string[] | null,
  env: Record<string, string | undefined> = {},
  facts: Partial<LiveWindowFacts> = {}
): string[] {
  try {
    evaluateLiveWindow(
      args,
      { ...WINDOW_ENV, ...env },
      { ...WINDOW_FACTS, ...facts },
      fileExists
    )
    return []
  } catch (error) {
    if (error instanceof NetworkGuardError) return error.codes
    throw error
  }
}

describe('window approval: value format', () => {
  it('parses deployment, commit, start and end', () => {
    const parsed = parseLiveWindowApproval(WINDOW_VALUE)
    expect(parsed).toEqual({
      approval: {
        deployment: LIVE,
        commit: RELEASE,
        start: new Date('2026-12-15T02:00:00Z'),
        end: new Date('2026-12-15T05:00:00Z'),
        hours: 3,
      },
    })
  })

  it('treats an empty value as unset: refused as before', () => {
    expect(parseLiveWindowApproval('')).toHaveProperty(
      'refusal.code',
      'LIVE_WINDOW_INVALID'
    )
    expect(windowCodes(null, { [LIVE_WINDOW_APPROVAL_ENV]: '' })).toEqual([
      'LIVE_BACKEND_DEPLOY',
    ])
  })

  it.each([
    ['padded', ` ${WINDOW_VALUE}`],
    ['trailing newline', `${WINDOW_VALUE}\n`],
    ['upper-case deployment', WINDOW_VALUE.toUpperCase()],
    ['short commit', `${LIVE}@${RELEASE.slice(0, 12)}@2026-12-15T02:00Z+3h`],
    [
      'upper-case commit',
      `${LIVE}@${RELEASE.toUpperCase()}@2026-12-15T02:00Z+3h`,
    ],
    ['no time zone', `${LIVE}@${RELEASE}@2026-12-15T02:00+3h`],
    ['offset time zone', `${LIVE}@${RELEASE}@2026-12-15T02:00+01:00+3h`],
    ['date only', `${LIVE}@${RELEASE}@2026-12-15+3h`],
    ['impossible date', `${LIVE}@${RELEASE}@2026-02-30T02:00Z+3h`],
    ['impossible hour', `${LIVE}@${RELEASE}@2026-12-15T24:00Z+3h`],
    ['zero hours', `${LIVE}@${RELEASE}@2026-12-15T02:00Z+0h`],
    ['over the maximum', `${LIVE}@${RELEASE}@2026-12-15T02:00Z+5h`],
    ['minutes duration', `${LIVE}@${RELEASE}@2026-12-15T02:00Z+90m`],
    ['missing duration', `${LIVE}@${RELEASE}@2026-12-15T02:00Z`],
    ['deployment only', LIVE],
    ['typed deployment', `dev:${LIVE}@${RELEASE}@2026-12-15T02:00Z+3h`],
    ['extra field', `${WINDOW_VALUE}@x`],
    ['yes', 'yes'],
  ])('refuses a malformed value (%s)', (_label, value) => {
    expect(parseLiveWindowApproval(value)).toHaveProperty(
      'refusal.code',
      'LIVE_WINDOW_INVALID'
    )
    expect(windowCodes(null, { [LIVE_WINDOW_APPROVAL_ENV]: value })).toEqual([
      'LIVE_WINDOW_INVALID',
    ])
  })

  it(`accepts at most ${LIVE_WINDOW_MAX_HOURS} hours`, () => {
    expect(LIVE_WINDOW_MAX_HOURS).toBe(4)
    expect(
      parseLiveWindowApproval(`${LIVE}@${RELEASE}@2026-12-15T02:00Z+4h`)
    ).toHaveProperty('approval.hours', 4)
  })
})

describe('window approval: the allowed operations', () => {
  it('passes the dry check with no operation', () => {
    const decision = evaluateLiveWindow(null, WINDOW_ENV, WINDOW_FACTS)
    expect(decision.request).toBeNull()
    expect(decision.guard).toEqual({
      network: 'TESTNET',
      convexDeployments: [LIVE],
      liveBackendApproved: false,
      liveWindowApproved: true,
    })
  })

  it.each([
    [['deploy-dry-run'], ['deploy', '--dry-run']],
    [['deploy'], ['deploy']],
    [
      ['export', '/backups/stage0.zip'],
      ['export', '--include-file-storage', '--path', '/backups/stage0.zip'],
    ],
    [
      ['import', EXISTING_RESTORE],
      ['import', '--replace-all', '-y', EXISTING_RESTORE],
    ],
    [
      ['env-set', 'CHAIN_V2_ENABLED', 'true'],
      ['env', 'set', 'CHAIN_V2_ENABLED', 'true'],
    ],
    [
      ['env-set', 'STELLAR_NETWORK', 'TESTNET'],
      ['env', 'set', 'STELLAR_NETWORK', 'TESTNET'],
    ],
    [
      ['env-set', 'NETWORK_PASSPHRASE', TESTNET_PASSPHRASE],
      ['env', 'set', 'NETWORK_PASSPHRASE', TESTNET_PASSPHRASE],
    ],
    [
      ['env-set', 'STELLAR_RPC_URL', 'https://soroban-testnet.stellar.org'],
      ['env', 'set', 'STELLAR_RPC_URL', 'https://soroban-testnet.stellar.org'],
    ],
    [
      ['env-set', 'CORE_CONTRACT_ID', `C${'A'.repeat(55)}`],
      ['env', 'set', 'CORE_CONTRACT_ID', `C${'A'.repeat(55)}`],
    ],
    [
      ['env-set', 'CHAIN_EPOCH', 'testnet-2026-12-15'],
      ['env', 'set', 'CHAIN_EPOCH', 'testnet-2026-12-15'],
    ],
    [
      ['env-remove', 'INDEXER_START_LEDGER'],
      ['env', 'remove', 'INDEXER_START_LEDGER'],
    ],
    [
      ['convex-run', 'chain/backfill:setContractVersionV1', '{"table":"tips"}'],
      ['run', 'chain/backfill:setContractVersionV1', '{"table":"tips"}'],
    ],
    [
      ['convex-run', 'chain/config:getChainConfig'],
      ['run', 'chain/config:getChainConfig', '{}'],
    ],
    [['pause'], null],
    [['resume'], null],
  ])('allows %j', (args, convexArgs) => {
    const decision = evaluateLiveWindow(
      args,
      WINDOW_ENV,
      WINDOW_FACTS,
      fileExists
    )
    expect(decision.request?.convexArgs ?? null).toEqual(convexArgs)
    expect(decision.guard.liveWindowApproved).toBe(true)
  })

  it('allows every listed function and no other', () => {
    for (const fn of LIVE_WINDOW_FUNCTIONS) {
      expect(windowCodes(['convex-run', fn])).toEqual([])
    }
    expect(LIVE_WINDOW_FUNCTIONS).toEqual([
      'legacyTipCleanup:run',
      'authorEarningsBackfill:run',
      'chain/backfill:setContractVersionV1',
      'chain/config:getChainConfig',
      'chain/config:refreshChainConfig',
      'chain/indexer:replayFrom',
      'chain/indexer:ingestBackfill',
      'reconcileTips:recoverStuckPendingArticleTips',
      'reconcileTips:recoverStuckPendingHighlightTips',
    ])
    expect(LIVE_WINDOW_OPERATIONS).toEqual([
      'deploy-dry-run',
      'deploy',
      'export',
      'import',
      'env-set',
      'env-remove',
      'convex-run',
      'pause',
      'resume',
    ])
  })
})

describe('window approval: refusals', () => {
  it('leaves a deploy-kind run without it refused as before', () => {
    expect(
      windowCodes(['deploy'], { [LIVE_WINDOW_APPROVAL_ENV]: undefined })
    ).toEqual(['LIVE_BACKEND_DEPLOY'])
    expect(
      guardError(() =>
        assertScriptConvexDeployAllowed('push', {
          ...WINDOW_ENV,
          [LIVE_WINDOW_APPROVAL_ENV]: undefined,
        })
      ).codes
    ).toEqual(['LIVE_BACKEND_DEPLOY'])
  })

  it('does not let the operational approval open deploy-kind work', () => {
    expect(
      windowCodes(['deploy'], {
        [LIVE_WINDOW_APPROVAL_ENV]: undefined,
        [LIVE_BACKEND_APPROVAL_ENV]: LIVE,
      })
    ).toEqual(['APPROVAL_NOT_FOR_DEPLOY', 'LIVE_BACKEND_DEPLOY'])
    expect(
      windowCodes(['deploy'], { [LIVE_BACKEND_APPROVAL_ENV]: LIVE })
    ).toEqual(['APPROVAL_NOT_FOR_DEPLOY'])
  })

  it('refuses when HEAD is not the approved commit', () => {
    expect(windowCodes(['deploy'], {}, { head: 'b'.repeat(40) })).toEqual([
      'LIVE_WINDOW_COMMIT',
    ])
    expect(windowCodes(['deploy'], {}, { head: null })).toEqual([
      'LIVE_WINDOW_COMMIT',
    ])
  })

  it('refuses a dirty or unreadable checkout, or another working directory', () => {
    expect(windowCodes(['deploy'], {}, { dirty: true })).toEqual([
      'LIVE_WINDOW_DIRTY',
    ])
    expect(windowCodes(['deploy'], {}, { dirty: null })).toEqual([
      'LIVE_WINDOW_DIRTY',
    ])
    expect(windowCodes(['deploy'], {}, { cwdRoot: '/work/other' })).toEqual([
      'LIVE_WINDOW_DIRTY',
    ])
    expect(windowCodes(['deploy'], {}, { cwdRoot: null })).toEqual([
      'LIVE_WINDOW_DIRTY',
    ])
  })

  it('refuses before the start and from the end of the window', () => {
    expect(
      windowCodes(['deploy'], {}, { now: new Date('2026-12-15T01:59:59Z') })
    ).toEqual(['LIVE_WINDOW_NOT_STARTED'])
    expect(
      windowCodes(['deploy'], {}, { now: new Date('2026-12-15T05:00:00Z') })
    ).toEqual(['LIVE_WINDOW_EXPIRED'])
    expect(
      windowCodes(['deploy'], {}, { now: new Date('2027-01-01T00:00:00Z') })
    ).toEqual(['LIVE_WINDOW_EXPIRED'])
    expect(
      windowCodes(['deploy'], {}, { now: new Date('2026-12-15T04:59:59Z') })
    ).toEqual([])
  })

  it('refuses an approval found in a .env file or a committed file', () => {
    expect(
      windowCodes(['deploy'], {}, { envFileHits: [`${CHECKOUT}/.env.local`] })
    ).toEqual(['LIVE_WINDOW_IN_FILE'])
    expect(
      windowCodes(['deploy'], {}, { committedHits: ['docs/notes.md'] })
    ).toEqual(['LIVE_WINDOW_IN_FILE'])
  })

  it('refuses an approval for any deployment other than the live one', () => {
    for (const name of [ALLOWED, OTHER]) {
      expect(
        windowCodes(['deploy'], {
          [LIVE_WINDOW_APPROVAL_ENV]: `${name}@${RELEASE}@2026-12-15T02:00Z+3h`,
        })
      ).toEqual([
        // The window check and the shared guard each refuse the name.
        'LIVE_WINDOW_INVALID',
        'LIVE_WINDOW_CREDENTIAL',
        'LIVE_WINDOW_INVALID',
        'LIVE_WINDOW_OTHER_TARGET',
      ])
    }
  })

  it('refuses a deploy key for another deployment or of production type', () => {
    expect(
      windowCodes(['deploy'], { CONVEX_DEPLOY_KEY: `dev:${ALLOWED}|k` })
    ).toEqual(['LIVE_WINDOW_CREDENTIAL', 'LIVE_WINDOW_OTHER_TARGET'])
    expect(
      windowCodes(['deploy'], { CONVEX_DEPLOY_KEY: `prod:${LIVE}|k` })
    ).toEqual([
      'LIVE_WINDOW_CREDENTIAL',
      'PROD_CONVEX_TYPE',
      'LIVE_BACKEND_DEPLOY',
    ])
    expect(
      windowCodes(['deploy'], { CONVEX_DEPLOY_KEY: `prod:${OTHER}|k` })
    ).toEqual(['LIVE_WINDOW_CREDENTIAL', 'LIVE_WINDOW_OTHER_TARGET'])
    expect(windowCodes(['deploy'], { CONVEX_DEPLOY_KEY: undefined })).toEqual([
      'LIVE_WINDOW_CREDENTIAL',
      'UNKNOWN_CONVEX',
    ])
  })

  it('refuses every other Convex target in the same shell', () => {
    expect(
      windowCodes(['deploy'], { CONVEX_DEPLOYMENT: `dev:${LIVE}` })
    ).toEqual(['LIVE_WINDOW_OTHER_TARGET'])
    expect(
      windowCodes(['deploy'], { CONVEX_DEPLOYMENT: `dev:${ALLOWED}` })
    ).toEqual(['LIVE_WINDOW_OTHER_TARGET', 'LIVE_WINDOW_OTHER_TARGET'])
    expect(
      windowCodes(['deploy'], {
        NEXT_PUBLIC_CONVEX_URL: `https://${ALLOWED}.convex.cloud`,
      })
    ).toEqual(['LIVE_WINDOW_OTHER_TARGET'])
    expect(
      windowCodes(['deploy'], { CONVEX_URL: 'http://127.0.0.1:3210' })
    ).toEqual(['LIVE_WINDOW_OTHER_TARGET'])
    expect(
      windowCodes(['deploy'], {
        CONVEX_SELF_HOSTED_URL: 'http://127.0.0.1:3210',
      })
    ).toEqual(['LIVE_WINDOW_OTHER_TARGET', 'LIVE_WINDOW_OTHER_TARGET'])
    // The live URL itself may stay set.
    expect(
      windowCodes(['deploy'], {
        NEXT_PUBLIC_CONVEX_URL: `https://${LIVE}.convex.cloud`,
      })
    ).toEqual([])
  })

  it('refuses LOCAL mode', () => {
    const codes = windowCodes(['deploy'], {
      [NETWORK_GUARD_OPT_IN_ENV]: 'local',
      NEXT_PUBLIC_STELLAR_NETWORK: 'LOCAL',
    })
    expect(codes).toEqual(
      expect.arrayContaining(['LOCAL_LIVE_APPROVAL', 'LOCAL_CLOUD_CONVEX'])
    )
  })

  it('refuses mainnet in every form, approval or not', () => {
    const cases: Array<Record<string, string>> = [
      { NEXT_PUBLIC_STELLAR_NETWORK: 'MAINNET' },
      { NEXT_PUBLIC_STELLAR_NETWORK: 'PUBLIC' },
      { NEXT_PUBLIC_STELLAR_NETWORK: 'mainnet' },
      { STELLAR_NETWORK: 'MAINNET' },
      ...MAINNET_PASSPHRASE_FORMS.map((p) => ({ NETWORK_PASSPHRASE: p })),
      ...MAINNET_PASSPHRASE_FORMS.map((p) => ({
        NEXT_PUBLIC_NETWORK_PASSPHRASE: p,
      })),
      ...MAINNET_RPC_FORMS.map((u) => ({ STELLAR_RPC_URL: u })),
      ...MAINNET_RPC_FORMS.map((u) => ({ NEXT_PUBLIC_HORIZON_URL: u })),
    ]
    for (const env of cases) {
      const codes = windowCodes(['deploy'], env)
      expect(codes.length, JSON.stringify(env)).toBeGreaterThan(0)
      expect(
        codes.some((c) =>
          [
            'NOT_TESTNET',
            'CONFLICTING_NETWORK',
            'MAINNET_PASSPHRASE',
            'MAINNET_URL',
          ].includes(c)
        ),
        JSON.stringify(env)
      ).toBe(true)
    }
    expect(
      windowCodes(['deploy'], { NEXT_PUBLIC_STELLAR_NETWORK: undefined })
    ).toEqual(['MISSING_NETWORK'])
    expect(
      windowCodes(['deploy'], { [NETWORK_GUARD_OPT_IN_ENV]: undefined })
    ).toEqual(['MISSING_OPT_IN'])
  })

  it.each([
    [['unknown']],
    [['convex-dev']],
    [['deploy', '--prod']],
    [['deploy-dry-run', '--url', 'https://example.convex.cloud']],
    [['convex-run', 'testAccounts:setTestAccount', '{}']],
    [['convex-run', 'earningsTotalsBackfill:run']],
    [['convex-run', 'chain/backfill:setContractVersionV1', '[1]']],
    [['convex-run', 'chain/backfill:setContractVersionV1', '{bad']],
    [['env-set', 'TAB_SETTLER_SECRET', 'S...']],
    [['env-set', 'ARWEAVE_ENABLED', 'true']],
    [['env-set', 'STELLAR_NETWORK', 'PUBLIC']],
    [['env-set', 'STELLAR_NETWORK', 'testnet']],
    [['env-set', 'NETWORK_PASSPHRASE', MAINNET_PASSPHRASE]],
    [['env-set', 'STELLAR_RPC_URL', 'https://mainnet.sorobanrpc.com']],
    [['env-set', 'HORIZON_URL', 'https://horizon.stellar.org']],
    [['env-set', 'STELLAR_RPC_URL', 'http://soroban-testnet.stellar.org']],
    [['env-set', 'STELLAR_RPC_URL', 'https://rpc.example.org']],
    [['env-set', 'CHAIN_V2_ENABLED', 'yes']],
    [['env-set', 'CORE_CONTRACT_ID', 'GABC']],
    [['env-set', 'CHAIN_EPOCH', 'mainnet-1']],
    [['env-set', 'CHAIN_V2_ENABLED']],
    [['env-remove', 'STELLAR_NETWORK']],
    [['export', `${CHECKOUT}/snapshot.zip`]],
    [['export', '/backups/stage0.tar']],
    [['export', EXISTING_RESTORE]],
    [['import', '/backups/missing.zip']],
    [['import', `${CHECKOUT}/restore.zip`]],
    [['pause', 'now']],
  ])('refuses the request %j', (args) => {
    expect(windowCodes(args)).toEqual(['LIVE_WINDOW_OPERATION'])
  })

  it('reports every refusal at once', () => {
    expect(
      windowCodes(
        ['convex-dev'],
        { NEXT_PUBLIC_STELLAR_NETWORK: 'MAINNET' },
        { head: null, dirty: true, now: new Date('2027-01-01T00:00:00Z') }
      )
    ).toEqual([
      'LIVE_WINDOW_EXPIRED',
      'LIVE_WINDOW_COMMIT',
      'LIVE_WINDOW_DIRTY',
      'LIVE_WINDOW_OPERATION',
      'NOT_TESTNET',
    ])
  })
})

describe('window approval: shared guard input', () => {
  const WINDOW_INPUT: NetworkGuardInput = {
    ...SAFE,
    kind: 'deploy',
    convexUrls: [],
    convexDeployment: undefined,
    convexDeployKey: `dev:${LIVE}|k`,
    liveWindowDeployment: LIVE,
  }

  it('opens only the named live deployment for deploy-kind work', () => {
    expect(codesFor(WINDOW_INPUT)).toEqual([])
    expect(
      codesFor({ ...WINDOW_INPUT, liveWindowDeployment: undefined })
    ).toEqual(['LIVE_BACKEND_DEPLOY'])
    expect(
      codesFor({ ...WINDOW_INPUT, liveWindowDeployment: ALLOWED })
    ).toEqual(['LIVE_WINDOW_INVALID', 'LIVE_WINDOW_OTHER_TARGET'])
  })

  it('never applies to operational runs', () => {
    expect(codesFor({ ...WINDOW_INPUT, kind: 'operational' })).toEqual([
      'LIVE_WINDOW_NOT_FOR_TOOL',
      'LIVE_BACKEND_NOT_APPROVED',
    ])
  })

  it('never opens a production-type deployment', () => {
    expect(
      codesFor({ ...WINDOW_INPUT, convexDeployKey: `prod:${LIVE}|k` })
    ).toEqual(['PROD_CONVEX_TYPE', 'LIVE_BACKEND_DEPLOY'])
  })

  it('never relaxes control 1', () => {
    expect(
      codesFor({
        ...WINDOW_INPUT,
        stellarNetworks: ['MAINNET'],
        networkPassphrase: MAINNET_PASSPHRASE,
        stellarUrls: ['https://horizon.stellar.org'],
      })
    ).toEqual(['NOT_TESTNET', 'MAINNET_PASSPHRASE', 'MAINNET_URL'])
  })
})

describe('window approval: other tools refuse it', () => {
  const withWindow = { ...SCRIPT_ENV, [LIVE_WINDOW_APPROVAL_ENV]: WINDOW_VALUE }

  it('refuses operational, Stellar-only and deploy-kind script runs', () => {
    expect(
      guardError(() => assertScriptTestnetOnly('script', withWindow)).codes
    ).toEqual(['LIVE_WINDOW_NOT_FOR_TOOL'])
    expect(
      guardError(() =>
        assertScriptStellarTestnetOnly('contracts', {
          [NETWORK_GUARD_OPT_IN_ENV]: 'testnet',
          NEXT_PUBLIC_STELLAR_NETWORK: 'TESTNET',
          [LIVE_WINDOW_APPROVAL_ENV]: WINDOW_VALUE,
        })
      ).codes
    ).toEqual(['LIVE_WINDOW_NOT_FOR_TOOL'])
    expect(
      guardError(() => assertScriptConvexDeployAllowed('push', withWindow))
        .codes
    ).toEqual(['LIVE_WINDOW_NOT_FOR_TOOL'])
    expect(
      guardError(() => checkConvexDev(['--once'], withWindow)).codes
    ).toEqual(['LIVE_WINDOW_NOT_FOR_TOOL'])
  })

  it('keeps a live deploy through guard:convex refused', () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(runNetworkGuardCli(['--convex'], WINDOW_ENV)).toBe(1)
    const message = String(errors.mock.calls[0]?.[0])
    expect(message).toContain('LIVE_BACKEND_DEPLOY')
    expect(message).toContain('LIVE_WINDOW_NOT_FOR_TOOL')
    expect(message).not.toContain('key-material')
    vi.restoreAllMocks()
  })
})

describe('window approval: backend guards on the live deployment', () => {
  const LIVE_BACKEND_ENV = {
    STELLAR_NETWORK: 'TESTNET',
    CONVEX_CLOUD_URL: `https://${LIVE}.convex.cloud`,
    [LIVE_WINDOW_APPROVAL_ENV]: WINDOW_VALUE,
  }

  it('lets payment paths run on the live backend with STELLAR_NETWORK=TESTNET', () => {
    expect(assertBackendTestnet(LIVE_BACKEND_ENV)).toBe('TESTNET')
  })

  it('keeps maintenance and fixture guards refusing the live backend', () => {
    expect(
      guardError(() => assertNonProductionBackend('seed', LIVE_BACKEND_ENV))
        .codes
    ).toEqual(['LIVE_BACKEND_DEPLOY'])
  })
})

describe('window CLI', () => {
  afterEach(() => vi.restoreAllMocks())

  function cli(
    argv: string[],
    options: {
      env?: Record<string, string | undefined>
      facts?: Partial<LiveWindowFacts>
      dryRunOutput?: string
      logFails?: boolean
    } = {}
  ) {
    const spawned: string[][] = []
    const logged: LiveWindowLogEntry[] = []
    const out: string[] = []
    for (const method of ['log', 'warn', 'error'] as const) {
      vi.spyOn(console, method).mockImplementation((...args) => {
        out.push(args.map(String).join(' '))
      })
    }
    const code = runLiveWindowCli(
      argv,
      { ...WINDOW_ENV, ...options.env },
      {
        facts: () => ({ ...WINDOW_FACTS, ...options.facts }),
        spawn: (args, capture) => {
          spawned.push(args)
          return {
            status: 0,
            output: capture
              ? (options.dryRunOutput ??
                `Deploying code to deployment:\nhttps://${LIVE}.convex.cloud\n`)
              : '',
          }
        },
        log: (entry) => {
          if (options.logFails) {
            throw new NetworkGuardError('live window log', [
              { code: 'LIVE_WINDOW_LOG', message: 'cannot write' },
            ])
          }
          logged.push(entry)
        },
      }
    )
    return { code, spawned, logged, out: out.join('\n') }
  }

  it('check is a dry mode: no Convex call, one log line', () => {
    const result = cli(['check'])
    expect(result.code).toBe(0)
    expect(result.spawned).toEqual([])
    expect(result.out).toContain('Dry mode')
    expect(result.out).toContain('chain/backfill:setContractVersionV1')
    expect(result.logged).toEqual([
      {
        event: 'check',
        operation: 'check',
        deployment: LIVE,
        commit: RELEASE,
        windowEnd: '2026-12-15T05:00:00.000Z',
      },
    ])
  })

  it('check evaluates one operation', () => {
    expect(cli(['check', 'env-set', 'CHAIN_V2_ENABLED', 'true']).code).toBe(0)
    expect(cli(['check', 'env-set', 'TAB_SETTLER_SECRET', 'x']).code).toBe(1)
  })

  it('run prints the warning, logs, and runs the built command', () => {
    const result = cli(['run', 'env-set', 'CHAIN_V2_ENABLED', 'true'])
    expect(result.code).toBe(0)
    expect(result.spawned).toEqual([['env', 'set', 'CHAIN_V2_ENABLED', 'true']])
    for (const text of [
      LIVE,
      RELEASE,
      'env-set CHAIN_V2_ENABLED=true',
      '2026-12-15T05:00:00.000Z',
    ]) {
      expect(result.out).toContain(text)
    }
    expect(result.logged.map((e) => e.event)).toEqual(['allowed', 'finished'])
    expect(JSON.stringify(result.logged)).not.toContain('key-material')
    expect(result.out).not.toContain('key-material')
  })

  it('deploy pushes only after a dry run that names the approved deployment', () => {
    expect(cli(['run', 'deploy']).spawned).toEqual([
      ['deploy', '--dry-run'],
      ['deploy'],
    ])
    for (const output of [
      `https://${ALLOWED}.convex.cloud`,
      `https://${LIVE}.convex.cloud https://${ALLOWED}.convex.cloud`,
      'no url',
    ]) {
      const result = cli(['run', 'deploy'], { dryRunOutput: output })
      expect(result.code).toBe(1)
      expect(result.spawned).toEqual([['deploy', '--dry-run']])
    }
  })

  it('runs nothing when refused, and logs the refusal', () => {
    const result = cli(['run', 'deploy'], { facts: { dirty: true } })
    expect(result.code).toBe(1)
    expect(result.spawned).toEqual([])
    expect(result.logged).toEqual([
      expect.objectContaining({
        event: 'refused',
        codes: ['LIVE_WINDOW_DIRTY'],
      }),
    ])
  })

  it('never logs or prints a refused value', () => {
    for (const argv of [
      ['run', 'env-set', 'TAB_SETTLER_SECRET', 'SSECRETVALUE'],
      ['run', 'env-set', 'CHAIN_V2_ENABLED', 'SSECRETVALUE'],
      ['check', 'convex-run', 'SSECRETVALUE:run'],
      ['run', 'SSECRETVALUE'],
      ['run', 'import', '/backups/SSECRETVALUE.zip'],
    ]) {
      const result = cli(argv)
      expect(result.code).toBe(1)
      expect(result.out).not.toContain('SSECRETVALUE')
      expect(JSON.stringify(result.logged)).not.toContain('SSECRETVALUE')
    }
    expect(cli(['run', 'env-set', 'TAB_SETTLER_SECRET', 'x']).logged).toEqual([
      expect.objectContaining({ operation: 'env-set TAB_SETTLER_SECRET' }),
    ])
  })

  it('runs nothing when the log cannot be written', () => {
    const result = cli(['run', 'deploy'], { logFails: true })
    expect(result.code).toBe(1)
    expect(result.spawned).toEqual([])
  })

  it('records pause and resume without running a command', () => {
    const result = cli(['run', 'pause'])
    expect(result.code).toBe(0)
    expect(result.spawned).toEqual([])
    expect(result.logged.map((e) => e.event)).toEqual(['allowed', 'dashboard'])
  })

  it('shows usage for an unknown command', () => {
    expect(cli(['deploy']).code).toBe(2)
    expect(cli(['run']).code).toBe(2)
  })
})

describe('window log and local facts', () => {
  const tempDirs: string[] = []
  function tempDir(): string {
    const dir = fs.realpathSync(
      fs.mkdtempSync(path.join(os.tmpdir(), 'live-window-'))
    )
    tempDirs.push(dir)
    return dir
  }
  afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })

  it('defaults the log under the home directory', () => {
    expect(liveWindowLogPath({}, '/home/operator')).toBe(
      '/home/operator/.quilltip/live-window.log'
    )
    expect(liveWindowLogPath({ [LIVE_WINDOW_LOG_ENV]: '/var/log/w.log' })).toBe(
      '/var/log/w.log'
    )
  })

  it('appends JSON lines outside the repository and refuses a path inside it', () => {
    const repo = tempDir()
    const outside = tempDir()
    const file = path.join(outside, 'logs', 'window.log')
    const entry: LiveWindowLogEntry = {
      event: 'allowed',
      operation: 'deploy',
      deployment: LIVE,
      commit: RELEASE,
    }
    appendLiveWindowLog(
      entry,
      { [LIVE_WINDOW_LOG_ENV]: file },
      repo,
      WINDOW_NOW
    )
    appendLiveWindowLog(
      entry,
      { [LIVE_WINDOW_LOG_ENV]: file },
      repo,
      WINDOW_NOW
    )
    const lines = fs.readFileSync(file, 'utf8').trim().split('\n')
    expect(lines).toHaveLength(2)
    expect(JSON.parse(lines[0] as string)).toEqual({
      time: '2026-12-15T03:00:00.000Z',
      event: 'allowed',
      operation: 'deploy',
      deployment: LIVE,
      commit: RELEASE,
      windowEnd: null,
      codes: [],
      exitCode: null,
    })
    expect(
      guardError(() =>
        appendLiveWindowLog(
          entry,
          { [LIVE_WINDOW_LOG_ENV]: path.join(repo, 'window.log') },
          repo
        )
      ).codes
    ).toEqual(['LIVE_WINDOW_LOG'])
  })

  it('writes only named fields to the log', () => {
    const line = formatLiveWindowLogLine(
      {
        event: 'allowed',
        operation: 'deploy',
        ...({ key: DEPLOY_KEY } as object),
      } as LiveWindowLogEntry,
      WINDOW_NOW
    )
    expect(line).not.toContain('key-material')
  })

  it('finds the approval assigned in any .env file', () => {
    const dir = tempDir()
    fs.writeFileSync(path.join(dir, '.env.example'), 'A=1\n')
    fs.writeFileSync(
      path.join(dir, '.env.local'),
      `X=1\n${LIVE_WINDOW_APPROVAL_ENV}=${WINDOW_VALUE}\n`
    )
    fs.writeFileSync(
      path.join(dir, '.envrc'),
      `export ${LIVE_WINDOW_APPROVAL_ENV}="${WINDOW_VALUE}"\n`
    )
    expect(envFilesAssigningApproval([dir])).toEqual([
      path.join(dir, '.env.local'),
      path.join(dir, '.envrc'),
    ])
  })

  it('reads HEAD, changes and committed values from the checkout', () => {
    const repo = tempDir()
    const git = (...args: string[]) =>
      execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8' })
    git('init', '-q')
    fs.writeFileSync(path.join(repo, 'README.md'), 'release\n')
    git('add', 'README.md')
    git(
      '-c',
      'user.name=Window Test',
      '-c',
      'user.email=window@example.test',
      '-c',
      'commit.gpgsign=false',
      'commit',
      '-q',
      '-m',
      'release'
    )
    const head = git('rev-parse', 'HEAD').trim()
    const value = `${LIVE}@${head}@2026-12-15T02:00Z+3h`
    const env = { [LIVE_WINDOW_APPROVAL_ENV]: value }
    const clean = readLiveWindowFacts(env, { checkoutRoot: repo, cwd: repo })
    expect(clean).toMatchObject({
      head,
      dirty: false,
      checkoutRoot: repo,
      cwdRoot: repo,
      envFileHits: [],
      committedHits: [],
    })

    fs.writeFileSync(path.join(repo, 'untracked.txt'), 'x\n')
    expect(
      readLiveWindowFacts(env, { checkoutRoot: repo, cwd: repo }).dirty
    ).toBe(true)
    fs.rmSync(path.join(repo, 'untracked.txt'))

    fs.writeFileSync(path.join(repo, 'notes.md'), `window ${value}\n`)
    git('add', 'notes.md')
    git(
      '-c',
      'user.name=Window Test',
      '-c',
      'user.email=window@example.test',
      '-c',
      'commit.gpgsign=false',
      'commit',
      '-q',
      '-m',
      'notes'
    )
    expect(
      readLiveWindowFacts(env, { checkoutRoot: repo, cwd: repo }).committedHits
    ).toEqual(['notes.md'])

    const other = tempDir()
    expect(
      readLiveWindowFacts(env, { checkoutRoot: repo, cwd: other }).cwdRoot
    ).toBeNull()
  })
})
