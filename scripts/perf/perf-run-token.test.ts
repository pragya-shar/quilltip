import type { AddressInfo } from 'net'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { api } from '../../convex/_generated/api'
import { PERF_RUN_HEADER, publicQuery } from '../../lib/seo/publicQuery'
import {
  fixtureBackendReads,
  fixtureRun,
  foreignBackendReads,
  resetFixtureBackendReads,
  startFixtureBackend,
} from './fixture-backend'

/**
 * The perf checks' run id (#630): on a shared machine another process can
 * query the same fixture port. The app's server stamps its reads with the
 * run id, and the fixture backend counts only reads that carry it.
 */

describe('publicQuery and the run id', () => {
  const sent: Headers[] = []
  beforeEach(() => {
    sent.length = 0
    vi.stubEnv('NEXT_PUBLIC_CONVEX_URL', 'http://127.0.0.1:3299')
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_: unknown, init?: RequestInit) => {
        sent.push(new Headers(init?.headers))
        return Response.json({ status: 'success', value: false, logLines: [] })
      })
    )
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
  })
  const read = () =>
    publicQuery(1500, api.publicRoutes.publicRouteExists, { username: 'x' })

  it('sends the run id when PERF_RUN_TOKEN is set', async () => {
    vi.stubEnv('PERF_RUN_TOKEN', 'run-1')
    await read()
    expect(sent[0]!.get(PERF_RUN_HEADER)).toBe('run-1')
  })

  it('sends no run id otherwise', async () => {
    vi.stubEnv('PERF_RUN_TOKEN', '')
    await read()
    expect(sent[0]!.has(PERF_RUN_HEADER)).toBe(false)
  })
})

describe('the fixture backend and the run id', () => {
  let server: ReturnType<typeof startFixtureBackend>
  let base: string
  beforeEach(async () => {
    server = startFixtureBackend(0)
    await new Promise((r) => server.once('listening', r))
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
    resetFixtureBackendReads()
  })
  afterEach(() => {
    fixtureRun.token = undefined
    server.closeAllConnections()
    server.close()
  })
  const query = (headers: Record<string, string> = {}) =>
    fetch(`${base}/api/query`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify({ path: 'articles:listArticles', args: [{}] }),
    }).then((r) => r.arrayBuffer())

  it("counts this run's reads and keeps the others apart", async () => {
    fixtureRun.token = 'run-1'
    await query({ [PERF_RUN_HEADER]: 'run-1' })
    await query({ [PERF_RUN_HEADER]: 'run-2' })
    await query()
    expect(fixtureBackendReads.get('articles:listArticles')).toBe(1)
    expect(foreignBackendReads.get('articles:listArticles')).toBe(2)
  })

  it('counts every read when no run id is set', async () => {
    await query()
    await query({ [PERF_RUN_HEADER]: 'run-2' })
    expect(fixtureBackendReads.get('articles:listArticles')).toBe(2)
    expect(foreignBackendReads.size).toBe(0)
  })
})
