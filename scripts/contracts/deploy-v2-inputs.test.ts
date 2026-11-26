/**
 * Input variations for the v2 deployment tool: mainnet in other URL and
 * passphrase forms, the second Convex deploy-key name, and the Convex env step's
 * protection against a deploy key in `.env.local`.
 */
import { describe, expect, it } from 'vitest'

import { NETWORK_GUARD_OPT_IN_ENV } from '../../convex/lib/networkGuard'
import { checkConvexDev } from '../convex-dev'
import {
  NetworkGuardError,
  assertScriptConvexDeployAllowed,
  assertScriptStellarTestnetOnly,
} from '../lib/network-guard'
import {
  INTEGRATION_CONVEX_DEPLOYMENT,
  convexCliEnv,
} from './deploy-v2/convex-env'
import { resolveDeployNetwork } from './deploy-v2/network'

const TESTNET_PASSPHRASE = 'Test SDF Network ; September 2015'
const MAINNET_PASSPHRASE = 'Public Global Stellar Network ; September 2015'
const LIVE = 'upbeat-mockingbird-579'
const TOKEN_SECRET = 'not-a-real-token-value-0123456789'

const TESTNET_ENV = {
  [NETWORK_GUARD_OPT_IN_ENV]: 'testnet',
  NEXT_PUBLIC_STELLAR_NETWORK: 'TESTNET',
  NEXT_PUBLIC_SOROBAN_RPC_URL: 'https://soroban-testnet.stellar.org',
  NEXT_PUBLIC_NETWORK_PASSPHRASE: TESTNET_PASSPHRASE,
}

function refusal(fn: () => unknown): NetworkGuardError {
  try {
    fn()
  } catch (error) {
    if (error instanceof NetworkGuardError) return error
    throw error
  }
  throw new Error('expected a network guard refusal')
}

describe('the deployment guard refuses mainnet in other forms', () => {
  it.each([
    'https://mainnet.sorobanrpc.com.',
    'HTTPS://MAINNET.SOROBANRPC.COM:443/',
    'https://user:pass@mainnet.sorobanrpc.com',
    'https://ｍａｉｎｎｅｔ.sorobanrpc.com',
    'https://horizon%2Estellar.org',
    'https://horizon.stellar.org./',
  ])('refuses the RPC URL %s in every RPC variable', (url) => {
    for (const name of [
      'STELLAR_RPC_URL',
      'NEXT_PUBLIC_STELLAR_RPC_URL',
      'NEXT_PUBLIC_SOROBAN_RPC_URL',
    ]) {
      expect(
        refusal(() => resolveDeployNetwork({ ...TESTNET_ENV, [name]: url }))
          .codes
      ).toContain('MAINNET_URL')
    }
  })

  it.each([
    MAINNET_PASSPHRASE.replace(/ /g, ' '),
    MAINNET_PASSPHRASE.replace(/ /g, '\t'),
    'Ｐｕｂｌｉｃ Global Stellar Network ; September 2015',
  ])('refuses the mainnet passphrase spelled %j', (passphrase) => {
    expect(
      refusal(() =>
        resolveDeployNetwork({ ...TESTNET_ENV, NETWORK_PASSPHRASE: passphrase })
      ).codes
    ).toContain('MAINNET_PASSPHRASE')
  })
})

describe('CONVEX_DEPLOYMENT_TOKEN, the second deploy-key name', () => {
  it('is refused by the Stellar-only guard without printing it', () => {
    const error = refusal(() =>
      assertScriptStellarTestnetOnly('deploy', {
        ...TESTNET_ENV,
        CONVEX_DEPLOYMENT_TOKEN: `prod:${LIVE}|${TOKEN_SECRET}`,
      })
    )
    expect(error.codes).toContain('CONVEX_KEY_FOR_STELLAR_ONLY')
    expect(error.message).not.toContain(TOKEN_SECRET)
  })

  it('cannot point deploy work at the live backend', () => {
    const env = {
      [NETWORK_GUARD_OPT_IN_ENV]: 'testnet',
      CONVEX_DEPLOYMENT: 'dev:efficient-tern-39',
      CONVEX_DEPLOYMENT_TOKEN: `prod:${LIVE}|${TOKEN_SECRET}`,
    }
    const deploy = refusal(() => assertScriptConvexDeployAllowed('deploy', env))
    expect(deploy.codes).toContain('LIVE_BACKEND_DEPLOY')
    expect(deploy.message).not.toContain(TOKEN_SECRET)
    expect(refusal(() => checkConvexDev([], env)).codes).toContain(
      'LIVE_BACKEND_DEPLOY'
    )
  })

  it('is refused when it does not name its deployment', () => {
    const error = refusal(() =>
      assertScriptConvexDeployAllowed('deploy', {
        [NETWORK_GUARD_OPT_IN_ENV]: 'testnet',
        CONVEX_DEPLOYMENT: 'dev:efficient-tern-39',
        CONVEX_DEPLOYMENT_TOKEN: TOKEN_SECRET,
      })
    )
    expect(error.codes).toContain('CONVEX_NOT_ALLOWLISTED')
    expect(error.message).not.toContain(TOKEN_SECRET)
  })

  it('counts as a Convex CLI target on its own', () => {
    expect(
      refusal(() =>
        assertScriptConvexDeployAllowed('deploy', {
          [NETWORK_GUARD_OPT_IN_ENV]: 'testnet',
          CONVEX_DEPLOYMENT_TOKEN: `prod:${LIVE}|${TOKEN_SECRET}`,
        })
      ).codes
    ).toContain('LIVE_BACKEND_DEPLOY')
  })
})

describe('the Convex env step keeps .env.local from redirecting it', () => {
  it('passes every Convex target name, blank, so dotenv cannot fill it', () => {
    const env = convexCliEnv(INTEGRATION_CONVEX_DEPLOYMENT, {
      ...TESTNET_ENV,
      CONVEX_DEPLOY_KEY: undefined,
    })
    for (const name of [
      'CONVEX_DEPLOY_KEY',
      'CONVEX_DEPLOYMENT_TOKEN',
      'CONVEX_SELF_HOSTED_URL',
      'CONVEX_SELF_HOSTED_ADMIN_KEY',
    ]) {
      expect(Object.prototype.hasOwnProperty.call(env, name)).toBe(true)
      expect(env[name]).toBe('')
    }
    expect(env.CONVEX_DEPLOYMENT).toBe(`dev:${INTEGRATION_CONVEX_DEPLOYMENT}`)
  })

  it('replaces a deploy key or token from the caller', () => {
    const env = convexCliEnv(INTEGRATION_CONVEX_DEPLOYMENT, {
      ...TESTNET_ENV,
      CONVEX_DEPLOY_KEY: `prod:${LIVE}|${TOKEN_SECRET}`,
      CONVEX_DEPLOYMENT_TOKEN: `prod:${LIVE}|${TOKEN_SECRET}`,
    })
    expect([env.CONVEX_DEPLOY_KEY, env.CONVEX_DEPLOYMENT_TOKEN]).toEqual([
      '',
      '',
    ])
  })
})
