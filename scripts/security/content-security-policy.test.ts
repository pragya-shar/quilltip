import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

import {
  buildContentSecurityPolicy,
  NONCE_HEADER,
} from '@/lib/security/contentSecurityPolicy'

const fetchQuery = vi.hoisted(() => vi.fn())
vi.mock('convex/nextjs', () => ({ fetchQuery }))

const { proxy } = await import('../../proxy')

const CONVEX_URL = 'https://example-deployment-123.convex.cloud'

function directives(policy: string): Map<string, string[]> {
  return new Map(
    policy
      .split(';')
      .map((part) => part.trim().split(/\s+/))
      .filter((tokens) => tokens[0])
      .map(([name, ...sources]) => [name!, sources])
  )
}

async function pageResponse(path: string, headers?: Record<string, string>) {
  return proxy(new NextRequest(`https://quilltip.test${path}`, { headers }))
}

function policyOf(response: Response): Map<string, string[]> {
  const header = response.headers.get('content-security-policy')
  expect(header, 'Content-Security-Policy header').toBeTruthy()
  return directives(header!)
}

beforeEach(() => {
  vi.stubEnv('NODE_ENV', 'production')
  vi.stubEnv('NEXT_PUBLIC_CONVEX_URL', CONVEX_URL)
  vi.stubEnv('NEXT_PUBLIC_HORIZON_URL', 'https://horizon-testnet.stellar.org')
  vi.stubEnv(
    'NEXT_PUBLIC_SOROBAN_RPC_URL',
    'https://soroban-testnet.stellar.org'
  )
  vi.stubEnv('NEXT_PUBLIC_STELLAR_RPC_URL', '')
  vi.stubEnv('VERCEL_ENV', '')
  fetchQuery.mockReset()
})

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('content security policy on proxy responses', () => {
  // The shell's home and Pocket, and an old page still rendered (`/articles`
  // and `/login` only redirect now, and a redirect carries no policy).
  it.each(['/', '/pocket', '/wallet/practice'])(
    '%s allows scripts only from self and the response nonce',
    async (path) => {
      const response = await pageResponse(path)
      const scriptSrc = policyOf(response).get('script-src') ?? []
      expect(scriptSrc).toHaveLength(2)
      expect(scriptSrc[0]).toBe("'self'")
      expect(scriptSrc[1]).toMatch(/^'nonce-[A-Za-z0-9+/]{22}=='$/)
      expect(scriptSrc).not.toContain("'unsafe-inline'")
      expect(scriptSrc).not.toContain("'unsafe-eval'")
    }
  )

  it('forwards the same nonce to the page renderer', async () => {
    const response = await pageResponse('/pocket')
    const policy = response.headers.get('content-security-policy')!
    const nonce = policy.match(/'nonce-([^']+)'/)![1]
    // NextResponse.next({ request }) passes overridden request headers to the
    // renderer as x-middleware-request-* headers.
    expect(
      response.headers.get('x-middleware-request-content-security-policy')
    ).toBe(policy)
    expect(response.headers.get(`x-middleware-request-${NONCE_HEADER}`)).toBe(
      nonce
    )
  })

  it('issues a fresh nonce for every response', async () => {
    const nonces = new Set<string>()
    for (let index = 0; index < 20; index++) {
      const policy = policyOf(await pageResponse('/'))
      nonces.add(policy.get('script-src')![1]!)
    }
    expect(nonces.size).toBe(20)
  })

  it('limits connect-src to the Convex deployment and Stellar testnet', async () => {
    const connectSrc = policyOf(await pageResponse('/')).get('connect-src')
    expect(connectSrc).toEqual([
      "'self'",
      CONVEX_URL,
      'wss://example-deployment-123.convex.cloud',
      'https://horizon-testnet.stellar.org',
      'https://soroban-testnet.stellar.org',
      'https://friendbot.stellar.org',
    ])
  })

  it('sets the restrictive document directives', async () => {
    const policy = policyOf(await pageResponse('/'))
    expect(policy.get('default-src')).toEqual(["'self'"])
    expect(policy.get('object-src')).toEqual(["'none'"])
    expect(policy.get('base-uri')).toEqual(["'none'"])
    expect(policy.get('form-action')).toEqual(["'self'"])
    expect(policy.get('frame-ancestors')).toEqual(["'none'"])
    expect(policy.get('frame-src')).toEqual([
      "'self'",
      'https://www.youtube.com',
      'https://www.youtube-nocookie.com',
      'https://albedo.link',
    ])
  })

  it('keeps the policy on a missing article answered with 404', async () => {
    fetchQuery.mockResolvedValue({ kind: 'missing' })
    const response = await pageResponse('/someone/missing-article')
    expect(response.status).toBe(404)
    expect(policyOf(response).get('script-src')?.[1]).toMatch(/^'nonce-/)
    expect(
      response.headers.get('x-middleware-request-content-security-policy')
    ).toBe(response.headers.get('content-security-policy'))
  })

  it('sends no policy in development, where Fast Refresh evaluates code', async () => {
    vi.stubEnv('NODE_ENV', 'development')
    const response = await pageResponse('/')
    expect(response.headers.get('content-security-policy')).toBeNull()
    expect(response.headers.get('x-frame-options')).toBe('DENY')
  })
})

describe('buildContentSecurityPolicy', () => {
  it('adds the Vercel toolbar on preview deployments only', () => {
    const preview = directives(
      buildContentSecurityPolicy('abc', { VERCEL_ENV: 'preview' })
    )
    expect(preview.get('script-src')).toContain('https://vercel.live')
    expect(preview.get('frame-src')).toContain('https://vercel.live')
    const production = buildContentSecurityPolicy('abc', {
      VERCEL_ENV: 'production',
    })
    expect(production).not.toContain('vercel.live')
  })

  it('lists a configured testnet RPC provider and ignores malformed values', () => {
    const policy = directives(
      buildContentSecurityPolicy('abc', {
        NEXT_PUBLIC_CONVEX_URL: 'not a url',
        NEXT_PUBLIC_SOROBAN_RPC_URL: 'https://rpc.testnet.example.org/soroban',
        NEXT_PUBLIC_STELLAR_RPC_URL: 'javascript:alert(1)',
      })
    )
    const connectSrc = policy.get('connect-src')!
    expect(connectSrc).toContain('https://rpc.testnet.example.org')
    expect(connectSrc.join(' ')).not.toMatch(/javascript|not a url|\*/)
  })

  it('serves a local Convex backend over http and ws', () => {
    const policy = directives(
      buildContentSecurityPolicy('abc', {
        NEXT_PUBLIC_CONVEX_URL: 'http://127.0.0.1:3210',
      })
    )
    expect(policy.get('connect-src')).toEqual(
      expect.arrayContaining(['http://127.0.0.1:3210', 'ws://127.0.0.1:3210'])
    )
  })

  it('names no mainnet Stellar endpoint by default', () => {
    const policy = buildContentSecurityPolicy('abc', {})
    expect(policy).not.toMatch(/horizon\.stellar\.org|mainnet/)
  })

  it('allows no WalletConnect host while no project ID is set', () => {
    expect(buildContentSecurityPolicy('abc', {})).not.toMatch(/walletconnect/)
    for (const id of ['', '   ', 'not-a-project-id']) {
      expect(
        buildContentSecurityPolicy('abc', {
          NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID: id,
        })
      ).not.toMatch(/walletconnect/)
    }
  })

  it('adds exactly the relay and Verify hosts when WalletConnect is on', () => {
    const policy = directives(
      buildContentSecurityPolicy('abc', {
        // Format only; not a real project.
        NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID:
          '0123456789abcdef0123456789abcdef',
      })
    )
    const hosts = (name: string) =>
      (policy.get(name) ?? []).filter((source) => /walletconnect/.test(source))
    expect(hosts('connect-src')).toEqual(['wss://relay.walletconnect.org'])
    expect(hosts('frame-src')).toEqual([
      'https://verify.walletconnect.org',
      'https://verify.walletconnect.com',
    ])
    for (const name of ['script-src', 'img-src', 'style-src', 'font-src']) {
      expect(hosts(name)).toEqual([])
    }
    // No wildcards and nothing from Reown AppKit.
    expect([...policy.values()].flat().join(' ')).not.toMatch(
      /\*\.walletconnect|reown|web3modal|pulse\./
    )
    expect(policy.get('script-src')).not.toContain("'unsafe-inline'")
  })
})
