import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  MAINNET_PASSPHRASE,
  TESTNET_PASSPHRASE,
} from '../../lib/stellar/network'
import {
  ALLOWED_CONVEX_DEPLOYMENTS,
  LIVE_BACKEND_APPROVAL_ENV,
  LIVE_CONVEX_DEPLOYMENTS,
  NETWORK_GUARD_OPT_IN_ENV,
  NetworkGuardError,
  assertBackendTestnet,
  assertNonProductionBackend,
  assertTestnetOnly,
  collectNetworkGuardRefusals,
  convexDeploymentNameFromUrl,
  parseConvexDeploymentRef,
  type NetworkGuardInput,
} from '../../lib/stellar/network-guard'
import { runNetworkGuardCli } from '../check-network-guard'
import {
  assertScriptConvexDeployAllowed,
  assertScriptTestnetOnly,
} from '../lib/network-guard'

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
    expect(codesFor({ optIn: '1' })).toEqual(['MISSING_OPT_IN'])
    expect(codesFor({ optIn: 'TESTNET ' })).toEqual(['MISSING_OPT_IN'])
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
