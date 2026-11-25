/**
 * Input-variation tests for the testnet guard: env precedence and conflicts,
 * value spelling, URL forms, CLI flags, and the client and backend checks.
 */
import { describe, expect, it } from 'vitest'

import {
  MAINNET_PASSPHRASE,
  TESTNET_PASSPHRASE,
} from '../../lib/stellar/network'
import {
  LIVE_BACKEND_APPROVAL_ENV,
  NETWORK_GUARD_OPT_IN_ENV,
  NetworkGuardError,
  assertClientTestnet,
  backendVerificationHorizonUrl,
  collectNetworkGuardRefusals,
  type NetworkGuardInput,
} from '../../lib/stellar/network-guard'
import { checkConvexDev, refusedConvexDevArgs } from '../convex-dev'
import {
  assertLocalBaseUrl,
  assertScriptConvexDeployAllowed,
  assertScriptTestnetOnly,
} from '../lib/network-guard'

const LIVE = 'upbeat-mockingbird-579'
const ALLOWED = 'efficient-tern-39'

const SAFE: NetworkGuardInput = {
  operation: 'input test',
  kind: 'operational',
  optIn: 'testnet',
  stellarNetworks: ['TESTNET'],
  convexDeployment: `dev:${ALLOWED}`,
}

const SCRIPT_ENV = {
  [NETWORK_GUARD_OPT_IN_ENV]: 'testnet',
  NEXT_PUBLIC_STELLAR_NETWORK: 'TESTNET',
  CONVEX_DEPLOYMENT: `dev:${ALLOWED}`,
  NEXT_PUBLIC_CONVEX_URL: `https://${ALLOWED}.convex.cloud`,
}

function codes(overrides: Partial<NetworkGuardInput>) {
  return collectNetworkGuardRefusals({ ...SAFE, ...overrides }).map(
    (r) => r.code
  )
}

function refusalCodes(fn: () => unknown) {
  try {
    fn()
  } catch (error) {
    if (error instanceof NetworkGuardError) return error.codes
    throw error
  }
  return []
}

describe('Convex target forms', () => {
  it.each([
    `https://${LIVE}.convex.cloud`,
    `https://${LIVE}.convex.site`,
    `https://${LIVE.toUpperCase()}.CONVEX.CLOUD`,
    `https://${LIVE}.eu-west-1.convex.cloud`,
    `https://${LIVE}.convex.cloud:443/api`,
    `https://user:pass@${LIVE}.convex.cloud`,
    `https://localhost@${LIVE}.convex.cloud`,
    `  https://${LIVE}.convex.cloud  `,
    // Full-width letters normalize to ASCII in URL parsing.
    `https://ｕpbeat-mockingbird-579.convex.cloud`,
  ])('treats %s as the live backend', (url) => {
    expect(codes({ convexUrls: [url], convexDeployment: undefined })).toContain(
      'LIVE_BACKEND_NOT_APPROVED'
    )
  })

  it.each([
    `https://${LIVE}.convex.cloud.`,
    'https://api.quilltip.me',
    'https://www.quilltip.me',
    'http://127.0.0.2:3210',
    'http://0.0.0.0:3210',
    'http://localhost.:3210',
    `https://xn--${LIVE}.convex.cloud`,
    `https://a.b.${LIVE}.convex.cloud`,
    'not a url',
  ])('refuses %s as an unknown target', (url) => {
    const result = codes({ convexUrls: [url], convexDeployment: undefined })
    expect(result.length).toBeGreaterThan(0)
    expect(
      result.every((c) =>
        ['CONVEX_NOT_ALLOWLISTED', 'INVALID_URL', 'UNKNOWN_CONVEX'].includes(c)
      )
    ).toBe(true)
  })

  it.each([
    `prod:${LIVE}`,
    `PROD:${LIVE}`,
    `  dev:${LIVE}  `,
    `${LIVE}`,
    `dev:${LIVE}|team-slug`,
  ])('refuses CONVEX_DEPLOYMENT=%s for deploy work', (value) => {
    expect(codes({ kind: 'deploy', convexDeployment: value })).toContain(
      'LIVE_BACKEND_DEPLOY'
    )
  })

  it.each([
    `prod:${LIVE}|secret-token`,
    `dev:${LIVE}|secret-token`,
    `${LIVE}|secret-token`,
  ])('refuses a deploy key that encodes the live deployment', (key) => {
    expect(
      codes({
        kind: 'deploy',
        convexDeployKey: key,
        convexDeployment: undefined,
      })
    ).toContain('LIVE_BACKEND_DEPLOY')
  })

  it.each([
    'preview:team:project|secret-token',
    'project:team:project|secret-token',
    'opaque-secret-token',
    `prod:${ALLOWED}|secret-token`,
  ])('refuses deploy key %s that is not an allowlisted dev target', (key) => {
    const result = codes({ kind: 'deploy', convexDeployKey: key })
    expect(result.length).toBeGreaterThan(0)
  })

  it('does not echo a deploy key that lacks a deployment prefix', () => {
    const refusals = collectNetworkGuardRefusals({
      ...SAFE,
      kind: 'deploy',
      convexDeployKey: 'opaque-secret-token',
    })
    expect(refusals.map((r) => r.code)).toContain('CONVEX_NOT_ALLOWLISTED')
    expect(JSON.stringify(refusals)).not.toContain('opaque-secret-token')
  })

  it('refuses when sources disagree even if one is allowlisted', () => {
    expect(
      codes({
        kind: 'deploy',
        convexDeployment: `dev:${ALLOWED}`,
        convexDeployKey: `prod:${LIVE}|secret-token`,
      })
    ).toContain('LIVE_BACKEND_DEPLOY')
    expect(
      codes({
        convexDeployment: `dev:${ALLOWED}`,
        convexUrls: [`https://${LIVE}.convex.cloud`],
      })
    ).toContain('LIVE_BACKEND_NOT_APPROVED')
  })

  it('does not let a local target hide a remote one', () => {
    expect(
      codes({
        kind: 'deploy',
        convexUrls: ['http://127.0.0.1:3210'],
        convexDeployment: `prod:${LIVE}`,
      })
    ).toContain('LIVE_BACKEND_DEPLOY')
  })

  it('refuses live names with stray whitespace or case in the allowlist', () => {
    expect(
      codes({ extraAllowedDeployments: ` ${LIVE.toUpperCase()} ` })
    ).toContain('LIVE_IN_ALLOWLIST')
  })
})

describe('live backend approval', () => {
  it('refuses the approval on deploy work, including the default kind', () => {
    for (const kind of ['deploy', undefined] as const) {
      expect(
        codes({
          kind,
          liveBackendApproval: LIVE,
          convexDeployment: `dev:${ALLOWED}`,
        })
      ).toContain('APPROVAL_NOT_FOR_DEPLOY')
    }
  })

  it('refuses the approval on deploy scripts read from the environment', () => {
    expect(
      refusalCodes(() =>
        assertScriptConvexDeployAllowed('push', {
          ...SCRIPT_ENV,
          [LIVE_BACKEND_APPROVAL_ENV]: LIVE,
        })
      )
    ).toContain('APPROVAL_NOT_FOR_DEPLOY')
  })

  it('accepts only the exact live name, ignoring case and whitespace', () => {
    expect(
      codes({
        convexDeployment: undefined,
        convexUrls: [`https://${LIVE}.convex.cloud`],
        liveBackendApproval: ` ${LIVE.toUpperCase()} `,
      })
    ).toEqual([])
    expect(
      codes({
        convexDeployment: undefined,
        convexUrls: [`https://${LIVE}.convex.cloud`],
        liveBackendApproval: `${LIVE},${ALLOWED}`,
      })
    ).toContain('INVALID_APPROVAL')
  })
})

describe('Stellar value spelling', () => {
  it.each(['testnet', 'Testnet', 'MAINNET', 'PUBLIC', 'TESTNET​'])(
    'refuses network value %j',
    (value) => {
      expect(codes({ stellarNetworks: [value] })).toContain('NOT_TESTNET')
    }
  )

  it('accepts TESTNET with surrounding whitespace', () => {
    expect(codes({ stellarNetworks: [' TESTNET '] })).toEqual([])
  })

  it.each([
    MAINNET_PASSPHRASE,
    ` ${MAINNET_PASSPHRASE} `,
    MAINNET_PASSPHRASE.toLowerCase(),
    'Test SDF Network ; September 2015.',
    'Test SDF Future Network ; October 2022',
  ])('refuses passphrase %j', (passphrase) => {
    const result = codes({ networkPassphrase: passphrase })
    expect(
      result.includes('MAINNET_PASSPHRASE') ||
        result.includes('UNKNOWN_PASSPHRASE')
    ).toBe(true)
  })

  it.each([
    'https://horizon.stellar.org.',
    'https://HORIZON.STELLAR.ORG',
    'https://horizon-testnet.stellar.org@horizon.stellar.org',
    'https://horizon-testnet.stellar.org.evil.example',
    'https://mainnet.sorobanrpc.com:443',
    'https://rpc-mainnet.example.org',
    'https://soroban-testnet.stellar.org.',
    'http://[::2]:8000',
  ])('refuses Stellar endpoint %s', (url) => {
    expect(codes({ stellarUrls: [url] }).length).toBeGreaterThan(0)
  })
})

describe('script environment', () => {
  it('reads the backend network variable as well as the client one', () => {
    expect(
      refusalCodes(() =>
        assertScriptTestnetOnly('run', {
          ...SCRIPT_ENV,
          STELLAR_NETWORK: 'MAINNET',
        })
      )
    ).toContain('NOT_TESTNET')
  })

  it('refuses a mainnet HORIZON_URL in a script environment', () => {
    expect(
      refusalCodes(() =>
        assertScriptTestnetOnly('run', {
          ...SCRIPT_ENV,
          HORIZON_URL: 'https://horizon.stellar.org',
        })
      )
    ).toContain('MAINNET_URL')
  })

  it('needs a Convex CLI target for deploy work, not only the client URL', () => {
    expect(
      refusalCodes(() =>
        assertScriptConvexDeployAllowed('push', {
          [NETWORK_GUARD_OPT_IN_ENV]: 'testnet',
          NEXT_PUBLIC_CONVEX_URL: `https://${ALLOWED}.convex.cloud`,
        })
      )
    ).toEqual(['UNKNOWN_CONVEX'])
    expect(
      refusalCodes(() =>
        assertScriptConvexDeployAllowed('push', {
          [NETWORK_GUARD_OPT_IN_ENV]: 'testnet',
          CONVEX_SELF_HOSTED_URL: 'http://127.0.0.1:3210',
        })
      )
    ).toEqual([])
  })

  it('refuses a self-hosted URL that points at the live backend', () => {
    expect(
      refusalCodes(() =>
        assertScriptConvexDeployAllowed('push', {
          [NETWORK_GUARD_OPT_IN_ENV]: 'testnet',
          CONVEX_SELF_HOSTED_URL: `https://${LIVE}.convex.cloud`,
        })
      )
    ).toContain('LIVE_BACKEND_DEPLOY')
  })
})

describe('guarded convex dev', () => {
  it('passes the flags package scripts use', () => {
    expect(refusedConvexDevArgs([])).toEqual([])
    expect(refusedConvexDevArgs(['--until-success'])).toEqual([])
    expect(
      refusedConvexDevArgs([
        '--once',
        '--typecheck',
        'disable',
        '--tail-logs=always',
      ])
    ).toEqual([])
  })

  it.each([
    ['--prod'],
    ['--url', `https://${LIVE}.convex.cloud`],
    [`--url=https://${LIVE}.convex.cloud`],
    ['--admin-key', 'secret'],
    ['--deployment', LIVE],
    ['--deployment-name', LIVE],
    ['--preview-name', 'x'],
    ['--env-file', '.env.production'],
    ['--configure'],
    ['--configure=existing'],
    ['--team', 'other'],
    ['--project', 'other'],
    ['--cloud'],
    ['--local'],
    ['--start', 'sh -c "convex deploy"'],
    ['--once=true'],
    ['--run'],
    ['--run', '--prod'],
    ['prod'],
  ])('refuses %j', (...args) => {
    expect(refusedConvexDevArgs(args).length).toBeGreaterThan(0)
  })

  it('names refused flags without printing their values', () => {
    let message = ''
    try {
      checkConvexDev(
        ['--admin-key', 'secret-admin-key', '--url=https://example.org'],
        SCRIPT_ENV
      )
    } catch (error) {
      message = (error as Error).message
    }
    expect(message).toContain('--admin-key')
    expect(message).toContain('--url')
    expect(message).not.toContain('secret-admin-key')
    expect(message).not.toContain('example.org')
  })

  it('runs the deploy guard before looking at flags', () => {
    expect(
      refusalCodes(() =>
        checkConvexDev(['--once'], {
          [NETWORK_GUARD_OPT_IN_ENV]: 'testnet',
          CONVEX_DEPLOYMENT: `prod:${LIVE}`,
        })
      )
    ).toContain('LIVE_BACKEND_DEPLOY')
    expect(refusalCodes(() => checkConvexDev(['--prod'], SCRIPT_ENV))).toEqual([
      'CONVEX_NOT_ALLOWLISTED',
    ])
    expect(refusalCodes(() => checkConvexDev(['--once'], SCRIPT_ENV))).toEqual(
      []
    )
  })
})

describe('client and backend runtime checks', () => {
  const client = {
    network: 'TESTNET',
    passphrase: TESTNET_PASSPHRASE,
    horizonUrl: 'https://horizon-testnet.stellar.org',
    rpcUrl: 'https://soroban-testnet.stellar.org',
  }

  it('accepts the testnet client configuration', () => {
    expect(assertClientTestnet(client)).toBe('TESTNET')
  })

  it.each([
    { network: 'MAINNET', passphrase: MAINNET_PASSPHRASE },
    { passphrase: MAINNET_PASSPHRASE },
    { horizonUrl: 'https://horizon.stellar.org' },
    { rpcUrl: 'https://mainnet.sorobanrpc.com' },
  ])('refuses client configuration %j', (override) => {
    expect(
      refusalCodes(() => assertClientTestnet({ ...client, ...override })).length
    ).toBeGreaterThan(0)
  })

  it('verifies only rows recorded on TESTNET', () => {
    expect(
      backendVerificationHorizonUrl('TESTNET', { allowOverride: true }, {})
    ).toBe('https://horizon-testnet.stellar.org')
    expect(
      backendVerificationHorizonUrl(undefined, { allowOverride: false }, {})
    ).toBe('https://horizon-testnet.stellar.org')
    expect(
      refusalCodes(() =>
        backendVerificationHorizonUrl('MAINNET', { allowOverride: true }, {})
      )
    ).toContain('NOT_TESTNET')
  })

  it('checks the Horizon override at verification time', () => {
    expect(
      refusalCodes(() =>
        backendVerificationHorizonUrl(
          'TESTNET',
          { allowOverride: true },
          { HORIZON_URL: 'https://horizon.stellar.org' }
        )
      )
    ).toContain('MAINNET_URL')
    expect(
      refusalCodes(() =>
        backendVerificationHorizonUrl(
          'TESTNET',
          { allowOverride: false },
          { STELLAR_NETWORK: 'MAINNET' }
        )
      )
    ).toContain('NOT_TESTNET')
  })
})

describe('browser test base URL', () => {
  it.each([
    'http://127.0.0.1:3100',
    'http://localhost:3000',
    'http://[::1]:4174',
  ])('accepts %s', (url) => {
    expect(() => assertLocalBaseUrl('e2e', url)).not.toThrow()
  })

  it.each([
    undefined,
    'https://www.quilltip.me',
    'http://127.0.0.1.nip.io:3100',
    'http://localhost@www.quilltip.me',
  ])('refuses %s', (url) => {
    expect(refusalCodes(() => assertLocalBaseUrl('e2e', url))).toEqual([
      'UNTRUSTED_URL',
    ])
  })
})
