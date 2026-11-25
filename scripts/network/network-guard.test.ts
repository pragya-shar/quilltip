import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  MAINNET_PASSPHRASE,
  TESTNET_PASSPHRASE,
} from '../../lib/stellar/network'
import {
  NETWORK_GUARD_OPT_IN_ENV,
  NetworkGuardError,
  PRODUCTION_CONVEX_DEPLOYMENTS,
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
  assertScriptNonProductionConvex,
  assertScriptTestnetOnly,
} from '../lib/network-guard'

const PROD = 'upbeat-mockingbird-579'

const SAFE: NetworkGuardInput = {
  operation: 'test operation',
  optIn: 'testnet',
  stellarNetworks: ['TESTNET'],
  networkPassphrase: TESTNET_PASSPHRASE,
  stellarUrls: [
    'https://horizon-testnet.stellar.org',
    'https://soroban-testnet.stellar.org',
  ],
  convexUrls: ['https://quiet-test-123.convex.cloud'],
  convexDeployment: 'dev:quiet-test-123',
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

describe('assertTestnetOnly', () => {
  it('passes for TESTNET with a non-production deployment and opt-in', () => {
    expect(collectNetworkGuardRefusals(SAFE)).toEqual([])
    expect(assertTestnetOnly(SAFE)).toEqual({
      network: 'TESTNET',
      convexDeployments: ['quiet-test-123'],
    })
  })

  it('lists the live deployment in the production denylist', () => {
    expect(PRODUCTION_CONVEX_DEPLOYMENTS).toContain(PROD)
  })

  it('refuses without the explicit opt-in', () => {
    expect(codesFor({ optIn: undefined })).toEqual(['MISSING_OPT_IN'])
    expect(codesFor({ optIn: '1' })).toEqual(['MISSING_OPT_IN'])
    expect(codesFor({ optIn: 'TESTNET ' })).toEqual(['MISSING_OPT_IN'])
  })

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

  it('refuses the mainnet passphrase', () => {
    expect(codesFor({ networkPassphrase: MAINNET_PASSPHRASE })).toEqual([
      'MAINNET_PASSPHRASE',
    ])
  })

  it('refuses an unknown passphrase', () => {
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

  it('refuses URLs outside the testnet allowlist', () => {
    expect(codesFor({ stellarUrls: ['https://rpc.example.org'] })).toEqual([
      'UNTRUSTED_URL',
    ])
  })

  it('accepts local Stellar endpoints', () => {
    expect(
      codesFor({ stellarUrls: ['http://localhost:8000/soroban/rpc'] })
    ).toEqual([])
  })

  it('refuses malformed URLs', () => {
    expect(codesFor({ stellarUrls: ['not a url'] })).toEqual(['INVALID_URL'])
  })

  it('refuses a production Convex URL', () => {
    expect(codesFor({ convexUrls: [`https://${PROD}.convex.cloud`] })).toEqual([
      'PRODUCTION_CONVEX',
    ])
    expect(codesFor({ convexUrls: [`https://${PROD}.convex.site/`] })).toEqual([
      'PRODUCTION_CONVEX',
    ])
  })

  it('refuses a production CONVEX_DEPLOYMENT in any form', () => {
    expect(codesFor({ convexDeployment: `dev:${PROD}` })).toEqual([
      'PRODUCTION_CONVEX',
    ])
    expect(codesFor({ convexDeployment: PROD })).toEqual(['PRODUCTION_CONVEX'])
    expect(codesFor({ convexDeployment: `dev:${PROD}|team` })).toEqual([
      'PRODUCTION_CONVEX',
    ])
  })

  it('refuses any production-type deployment or deploy key', () => {
    expect(codesFor({ convexDeployment: 'prod:quiet-test-123' })).toEqual([
      'PROD_CONVEX_TYPE',
    ])
    expect(codesFor({ convexDeployKey: 'prod:quiet-test-123|secret' })).toEqual(
      ['PROD_CONVEX_TYPE']
    )
  })

  it('refuses a deploy key for a production deployment', () => {
    expect(codesFor({ convexDeployKey: `dev:${PROD}|secret` })).toEqual([
      'PRODUCTION_CONVEX',
    ])
  })

  it('never prints deploy key secrets', () => {
    const error = guardError(() =>
      assertTestnetOnly({ ...SAFE, convexDeployKey: 'prod:x|super-secret' })
    )
    expect(error.message).not.toContain('super-secret')
  })

  it('adds deployments from the extra denylist', () => {
    expect(
      codesFor({ extraProductionDeployments: 'other-prod-1, QUIET-TEST-123' })
    ).toEqual(['PRODUCTION_CONVEX', 'PRODUCTION_CONVEX'])
  })

  it('refuses a missing Convex target when one is required', () => {
    expect(
      codesFor({
        requireConvexTarget: true,
        convexUrls: [],
        convexDeployment: undefined,
      })
    ).toEqual(['UNKNOWN_CONVEX'])
  })

  it('reports every refusal in one error', () => {
    const error = guardError(() =>
      assertTestnetOnly({
        operation: 'combined',
        stellarNetworks: ['MAINNET'],
        networkPassphrase: MAINNET_PASSPHRASE,
        stellarUrls: ['https://horizon.stellar.org'],
        convexUrls: [`https://${PROD}.convex.cloud`],
      })
    )
    expect(error.codes).toEqual([
      'MISSING_OPT_IN',
      'NOT_TESTNET',
      'MAINNET_PASSPHRASE',
      'MAINNET_URL',
      'PRODUCTION_CONVEX',
    ])
    expect(error.message).toContain('Network guard refused "combined"')
  })
})

describe('Convex helpers', () => {
  it('reads deployment names from Convex URLs', () => {
    expect(convexDeploymentNameFromUrl(`https://${PROD}.convex.cloud`)).toBe(
      PROD
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

  it('refuses operational functions on a production deployment', () => {
    expect(
      guardError(() =>
        assertNonProductionBackend('seed', {
          CONVEX_CLOUD_URL: `https://${PROD}.convex.cloud`,
        })
      ).codes
    ).toEqual(['PRODUCTION_CONVEX'])
  })

  it('refuses operational functions when the deployment is unknown', () => {
    expect(
      guardError(() => assertNonProductionBackend('seed', {})).codes
    ).toEqual(['UNKNOWN_CONVEX'])
  })

  it('allows operational functions on a non-production deployment', () => {
    expect(() =>
      assertNonProductionBackend('seed', {
        CONVEX_CLOUD_URL: 'https://quiet-test-123.convex.cloud',
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
  NEXT_PUBLIC_CONVEX_URL: 'https://quiet-test-123.convex.cloud',
  CONVEX_DEPLOYMENT: 'dev:quiet-test-123',
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

  it('refuses a production Convex URL from any env var', () => {
    for (const key of [
      'NEXT_PUBLIC_CONVEX_URL',
      'CONVEX_URL',
      'CONVEX_SELF_HOSTED_URL',
    ]) {
      expect(
        guardError(() =>
          assertScriptTestnetOnly('script', {
            ...SCRIPT_ENV,
            [key]: `https://${PROD}.convex.cloud`,
          })
        ).codes
      ).toContain('PRODUCTION_CONVEX')
    }
  })

  it('requires a Convex target for Convex-only tools', () => {
    expect(
      guardError(() =>
        assertScriptNonProductionConvex('push', {
          [NETWORK_GUARD_OPT_IN_ENV]: 'testnet',
        })
      ).codes
    ).toEqual(['UNKNOWN_CONVEX'])
    expect(
      assertScriptNonProductionConvex('push', {
        [NETWORK_GUARD_OPT_IN_ENV]: 'testnet',
        CONVEX_DEPLOYMENT: 'dev:quiet-test-123',
      }).convexDeployments
    ).toEqual(['quiet-test-123'])
  })
})

describe('guard CLI', () => {
  afterEach(() => vi.restoreAllMocks())

  it('exits 0 when the guard passes', () => {
    vi.spyOn(console, 'log').mockImplementation(() => {})
    expect(runNetworkGuardCli([], SCRIPT_ENV)).toBe(0)
    expect(runNetworkGuardCli(['--convex'], SCRIPT_ENV)).toBe(0)
  })

  it('exits 1 and prints the refusal', () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(
      runNetworkGuardCli(['--convex'], {
        ...SCRIPT_ENV,
        CONVEX_DEPLOYMENT: `dev:${PROD}`,
      })
    ).toBe(1)
    expect(String(errors.mock.calls[0]?.[0])).toContain('PRODUCTION_CONVEX')
  })
})
