import { describe, expect, it, vi } from 'vitest'

import {
  buildHealthReport,
  checkBackend,
  resolveBuildCommit,
} from '../../lib/health/buildHealthReport'

describe('resolveBuildCommit', () => {
  it('prefers the Vercel commit, then explicit and CI values', () => {
    expect(
      resolveBuildCommit({
        VERCEL_GIT_COMMIT_SHA: 'vercel',
        NEXT_PUBLIC_BUILD_COMMIT: 'explicit',
        GITHUB_SHA: 'ci',
      })
    ).toBe('vercel')
    expect(
      resolveBuildCommit({
        NEXT_PUBLIC_BUILD_COMMIT: 'explicit',
        GITHUB_SHA: 'ci',
      })
    ).toBe('explicit')
    expect(resolveBuildCommit({ GITHUB_SHA: 'ci' })).toBe('ci')
    expect(resolveBuildCommit({})).toBe('unknown')
  })
})

describe('checkBackend', () => {
  it('reports unconfigured without a Convex URL', async () => {
    expect(await checkBackend(undefined)).toBe('unconfigured')
  })

  it('calls the Convex version endpoint', async () => {
    const fetchImpl = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) =>
        new Response('1.0', { status: 200 })
    )
    expect(
      await checkBackend('https://quiet-test-123.convex.cloud', fetchImpl)
    ).toBe('ok')
    expect(String(fetchImpl.mock.calls[0]?.[0])).toBe(
      'https://quiet-test-123.convex.cloud/version'
    )
  })

  it('reports unreachable on errors and non-2xx answers', async () => {
    expect(
      await checkBackend('https://x.convex.cloud', async () => {
        throw new Error('down')
      })
    ).toBe('unreachable')
    expect(
      await checkBackend(
        'https://x.convex.cloud',
        async () => new Response('', { status: 502 })
      )
    ).toBe('unreachable')
  })
})

describe('buildHealthReport', () => {
  it('reports commit, environment, network, and status', () => {
    expect(
      buildHealthReport({
        env: { VERCEL_GIT_COMMIT_SHA: 'abc123', VERCEL_ENV: 'preview' },
        network: 'TESTNET',
        backend: 'ok',
        now: new Date('2026-01-01T00:00:00Z'),
      })
    ).toEqual({
      status: 'ok',
      commit: 'abc123',
      environment: 'preview',
      network: 'TESTNET',
      backend: 'ok',
      checkedAt: '2026-01-01T00:00:00.000Z',
    })
  })

  it('is degraded when the backend is not ok', () => {
    expect(
      buildHealthReport({ env: {}, network: 'TESTNET', backend: 'unreachable' })
        .status
    ).toBe('degraded')
  })
})
