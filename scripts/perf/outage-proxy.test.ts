import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { ARTICLE_ROUTE_HEADER } from '../../lib/seo/articleRoute'
import {
  READ_DEADLINE_HEADER,
  REQUEST_READ_BUDGET_MS,
} from '../../lib/seo/readDeadline'
import { PUBLIC_READ_TIMEOUT_MS } from '../../lib/seo/publicReadTimeout'
import { NEAR_MISS_BODY, PAUSED_BODY } from './paused-deployment-fixture'

/**
 * proxy.ts against a stand-in backend (#609): the check and its one retry,
 * the 503 outage response, the 5 s outage memory, and the headers it passes
 * to pages. Only Date is faked, so the outage memory can be stepped through;
 * the read limit runs on real timers, so an outage costs two real limits.
 */

type Mode =
  | 'answering'
  | 'silent'
  | 'failing'
  | 'slow-once'
  | 'function-error'
  | 'client-error'
  | 'paused'
  | 'near-miss'
const backend = { mode: 'answering' as Mode, reads: 0, slowOnceUsed: false }

function answer(path: string, args: { username?: string; slug?: string }) {
  if (path === 'publicRoutes:publicRouteExists') return false
  if (path === 'publicRoutes:resolvePublicRoute') {
    if (args.username === 'nobody') return { kind: 'missing' }
    return args.slug ? { kind: 'found', version: 'a1:1' } : { kind: 'found' }
  }
  throw new Error(`no stand-in for ${path}`)
}

function stubBackend(input: RequestInfo | URL, init?: RequestInit) {
  backend.reads += 1
  const signal = init?.signal
  const hang = () =>
    new Promise<Response>((_, reject) =>
      signal?.addEventListener('abort', () => reject(signal.reason))
    )
  if (backend.mode === 'silent') return hang()
  if (backend.mode === 'slow-once' && !backend.slowOnceUsed) {
    backend.slowOnceUsed = true
    return hang()
  }
  if (backend.mode === 'failing')
    return Promise.resolve(new Response('backend error', { status: 500 }))
  // Reachable but wrong: a function that threw (Convex answers 560 with an
  // error body), or a 4xx such as a function this backend does not have.
  if (backend.mode === 'function-error')
    return Promise.resolve(
      Response.json(
        { status: 'error', errorMessage: 'Could not find public function' },
        { status: 560 }
      )
    )
  if (backend.mode === 'paused')
    return Promise.resolve(Response.json(PAUSED_BODY, { status: 200 }))
  if (backend.mode === 'near-miss')
    return Promise.resolve(Response.json(NEAR_MISS_BODY, { status: 200 }))
  if (backend.mode === 'client-error')
    return Promise.resolve(new Response('bad request', { status: 400 }))
  const body = JSON.parse(String(init?.body)) as {
    path: string
    args: [{ username?: string; slug?: string }]
  }
  void input
  return Promise.resolve(
    Response.json({
      status: 'success',
      value: answer(body.path, body.args[0]),
      logLines: [],
    })
  )
}

let proxy: (request: NextRequest) => Promise<Response>
const request = (
  path: string,
  init: { method?: string; headers?: Record<string, string> } = {}
) => proxy(new NextRequest(`https://quilltip.test${path}`, init))
const forwarded = (response: Response, name: string) =>
  response.headers.get(`x-middleware-request-${name}`)
const timed = async (path: string) => {
  const started = performance.now()
  const response = await request(path)
  return { response, ms: performance.now() - started }
}

beforeEach(async () => {
  vi.stubEnv('NODE_ENV', 'production')
  vi.stubEnv('NEXT_PUBLIC_CONVEX_URL', 'http://127.0.0.1:3299')
  vi.stubGlobal('fetch', vi.fn(stubBackend))
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-11-28T12:00:00Z'))
  Object.assign(backend, { mode: 'answering', reads: 0, slowOnceUsed: false })
  // A fresh module: the outage memory and the "found" reuse start empty.
  vi.resetModules()
  proxy = (await import('../../proxy')).proxy
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

describe('a healthy backend', () => {
  it('checks /articles with one read and passes the deadline to the page', async () => {
    const response = await request('/articles')
    expect(response.status).toBe(200)
    expect(backend.reads).toBe(1)
    expect(forwarded(response, READ_DEADLINE_HEADER)).toBe(
      String(Date.now() + REQUEST_READ_BUDGET_MS)
    )
  })

  it('passes its own route answers and drops what a client sent', async () => {
    const sent = {
      [ARTICLE_ROUTE_HEADER]: 'found forged',
      [READ_DEADLINE_HEADER]: '9999999999999',
    }
    const article = await request('/fixture-writer/the-lamp', { headers: sent })
    expect(forwarded(article, ARTICLE_ROUTE_HEADER)).toBe('found a1:1')
    const writer = await request('/fixture-writer', { headers: sent })
    expect(forwarded(writer, ARTICLE_ROUTE_HEADER)).toBe('found')
    const apiHandle = await request('/apiary', { headers: sent })
    expect(forwarded(apiHandle, ARTICLE_ROUTE_HEADER)).toBe('found')
    for (const response of [article, writer, apiHandle])
      expect(forwarded(response, READ_DEADLINE_HEADER)).not.toBe(
        '9999999999999'
      )
    const home = await request('/', { headers: sent })
    expect(forwarded(home, ARTICLE_ROUTE_HEADER)).toBeNull()
    expect(forwarded(home, READ_DEADLINE_HEADER)).toBeNull()
  })

  it('answers a missing writer with 404 and stamps "missing"', async () => {
    const response = await request('/nobody')
    expect(response.status).toBe(404)
    expect(forwarded(response, ARTICLE_ROUTE_HEADER)).toBe('missing')
  })

  it('makes no read for / or for a path that starts with @', async () => {
    await request('/')
    await request('/@fixture-writer')
    expect(backend.reads).toBe(0)
  })
})

describe('one slow query against a healthy backend', () => {
  it('is absorbed by the retry: the page is served', async () => {
    backend.mode = 'slow-once'
    const { response, ms } = await timed('/fixture-writer/the-lamp')
    expect(response.status).toBe(200)
    expect(backend.reads).toBe(2)
    expect(ms).toBeLessThan(PUBLIC_READ_TIMEOUT_MS + 500)
  })
})

describe('a backend that answers wrongly', () => {
  it.each(['function-error', 'client-error'] as const)(
    '%s: no outage, no retry; the page renders and reads for itself',
    async (mode) => {
      backend.mode = mode
      const list = await request('/articles')
      expect(list.status).toBe(200)
      const article = await request('/fixture-writer/the-lamp')
      expect(article.status).toBe(200)
      expect(forwarded(article, ARTICLE_ROUTE_HEADER)).toBe('unknown')
      // One read each, no retry, and no outage declared.
      expect(backend.reads).toBe(2)
      backend.mode = 'answering'
      expect((await request('/articles')).status).toBe(200)
    }
  )
})

describe('a paused deployment', () => {
  it('answers 503 with Retry-After, as an unreachable backend does', async () => {
    backend.mode = 'paused'
    const { response, ms } = await timed('/articles')
    expect(response.status).toBe(503)
    expect(response.headers.get('retry-after')).toBe('30')
    expect(response.headers.get('cache-control')).toBe('no-store')
    // The refusal is immediate: both tries fail at once.
    expect(backend.reads).toBe(2)
    expect(ms).toBeLessThan(500)
    expect((await request('/fixture-writer/the-lamp')).status).toBe(503)
    expect(backend.reads).toBe(2)
  })

  it('a near miss (the same body shape and status, another message) is not an outage', async () => {
    backend.mode = 'near-miss'
    expect((await request('/articles')).status).toBe(200)
    const article = await request('/fixture-writer/the-lamp')
    expect(article.status).toBe(200)
    expect(forwarded(article, ARTICLE_ROUTE_HEADER)).toBe('unknown')
    expect(backend.reads).toBe(2)
  })
})

describe('an outage', () => {
  it.each(['silent', 'failing'] as const)(
    '%s backend: 503 within two limits, with Retry-After, no-store and the readable body',
    async (mode) => {
      backend.mode = mode
      const { response, ms } = await timed('/articles')
      expect(response.status).toBe(503)
      expect(response.headers.get('retry-after')).toBe('30')
      expect(response.headers.get('cache-control')).toBe('no-store')
      expect(response.headers.get('content-type')).toContain('text/html')
      const policy = response.headers.get('content-security-policy') ?? ''
      expect(policy).toContain("default-src 'none'")
      expect(policy).not.toContain('unsafe-inline')
      const html = await response.text()
      expect(html).toContain(
        '<h1>The articles could not be loaded right now.</h1>'
      )
      expect(policy).toContain(html.match(/nonce="([^"]+)"/)![1]!)
      expect(backend.reads).toBe(2)
      expect(ms).toBeLessThan(2 * PUBLIC_READ_TIMEOUT_MS + 500)
      if (mode === 'failing') expect(ms).toBeLessThan(500)
    },
    15_000
  )

  it('remembers the outage for 5 s: 100 requests make no read, and the memory does not renew itself', async () => {
    backend.mode = 'failing'
    expect((await request('/articles')).status).toBe(503)
    const declaredAt = Date.now()
    const readsAfterDeclaring = backend.reads
    const paths = ['/articles', '/fixture-writer', '/fixture-writer/the-lamp']
    for (let i = 0; i < 100; i++) {
      vi.setSystemTime(declaredAt + i * 40) // 0 to 3.96 s, inside the memory
      expect((await request(paths[i % 3]!)).status).toBe(503)
    }
    expect(backend.reads).toBe(readsAfterDeclaring)

    // The backend recovers. Requests just before the memory ends still get
    // 503; the first after it checks again and gets the page.
    backend.mode = 'answering'
    vi.setSystemTime(declaredAt + 4999)
    expect((await request('/articles')).status).toBe(503)
    vi.setSystemTime(declaredAt + 5001)
    expect((await request('/articles')).status).toBe(200)
    expect(backend.reads).toBe(readsAfterDeclaring + 1)
  })

  it('answers HEAD with the same headers and no body', async () => {
    backend.mode = 'failing'
    const response = await request('/fixture-writer/the-lamp', {
      method: 'HEAD',
    })
    expect(response.status).toBe(503)
    expect(response.headers.get('retry-after')).toBe('30')
    expect(await response.text()).toBe('')
  })

  it('keeps / at 200 with no read', async () => {
    backend.mode = 'silent'
    expect((await request('/')).status).toBe(200)
    expect(backend.reads).toBe(0)
  })

  it('reaches a writer page inside its "found" window only once a checked path declared the outage', async () => {
    // Found while the backend answered: the next 60 s reuse that answer.
    expect((await request('/fixture-writer')).status).toBe(200)
    backend.mode = 'failing'
    // The gap: no check runs, so the page gets its own 200 fallback.
    const reused = await request('/fixture-writer')
    expect(reused.status).toBe(200)
    expect(backend.reads).toBe(1)
    // A checked path declares the outage; then the writer page answers 503.
    expect((await request('/articles')).status).toBe(503)
    expect((await request('/fixture-writer')).status).toBe(503)
  })
})
