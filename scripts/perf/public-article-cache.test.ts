import { readFileSync } from 'node:fs'
import path from 'node:path'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { getFunctionName } from 'convex/server'
import { ARTICLE_ROUTE_HEADER } from '../../lib/seo/articleRoute'

/**
 * getPublishedArticle (lib/seo/publicContent.ts) against a stand-in backend,
 * the proxy's header, and an in-memory model of `unstable_cache` (an entry
 * per key parts and arguments). A cached copy may serve a request only for
 * the version just confirmed; when the check could not run, the page reads
 * directly. The production-build check is perf:unpublish-refresh.
 */

type Row = { id: string; updatedAt: number; published: boolean; text: string }
const state: {
  rows: Map<string, Row>
  routeHeader: string | null
  reads: number
  /** Every backend read the page made: a token would ride along here. */
  calls: unknown[][]
  /** Calls to the reads that could carry the visitor's token (#679). */
  tokenReads: string[]
} = { rows: new Map(), routeHeader: null, reads: 0, calls: [], tokenReads: [] }
const store = new Map<string, unknown>()

vi.mock('react', async (original) => ({
  ...(await original<typeof import('react')>()),
  // A request-scoped memo in React; each call here is a new request.
  cache: <T>(fn: T) => fn,
}))
vi.mock('next/headers', () => ({
  headers: async () =>
    new Headers(
      state.routeHeader ? { [ARTICLE_ROUTE_HEADER]: state.routeHeader } : {}
    ),
}))
vi.mock('next/cache', () => ({
  unstable_cache:
    <A extends unknown[], R>(
      fn: (...args: A) => Promise<R>,
      keyParts: string[]
    ) =>
    async (...args: A) => {
      const key = JSON.stringify([keyParts, args])
      if (!store.has(key)) store.set(key, await fn(...args))
      return store.get(key) as R
    },
}))
vi.mock('../../lib/seo/publicQuery', async (original) => ({
  ...(await original<typeof import('../../lib/seo/publicQuery')>()),
  publicQuery: async (...call: unknown[]) => {
    state.calls.push(call)
    const [, ref, args] = call as [number, never, { slug: string }]
    const row = state.rows.get(args.slug)
    const live = row?.published ? row : undefined
    switch (getFunctionName(ref)) {
      case 'publicRoutes:resolvePublicRoute':
        return live
          ? { kind: 'found', version: `${live.id}:${live.updatedAt}` }
          : { kind: 'missing' }
      case 'articles:getArticleBySlug':
        state.reads += 1
        return live ? { slug: args.slug, text: live.text } : null
    }
    throw new Error(`No stand-in for ${getFunctionName(ref)}`)
  },
}))
// Reads that send the visitor's auth token: the page must call neither.
vi.mock('convex/nextjs', () => ({
  fetchQuery: async () => {
    state.tokenReads.push('convex/nextjs fetchQuery')
    return null
  },
  preloadQuery: async () => {
    state.tokenReads.push('convex/nextjs preloadQuery')
    return null
  },
}))
vi.mock('@convex-dev/auth/nextjs/server', () => ({
  convexAuthNextjsToken: async () => {
    state.tokenReads.push('convexAuthNextjsToken')
    return 'visitor-token'
  },
  isAuthenticatedNextjs: async () => {
    state.tokenReads.push('isAuthenticatedNextjs')
    return true
  },
}))

const { getPublishedArticle } = await import('../../lib/seo/publicContent')

beforeEach(() => {
  store.clear()
  state.rows = new Map([
    ['lamp', { id: 'a1', updatedAt: 1, published: true, text: 'First text' }],
  ])
  state.routeHeader = null
  state.reads = 0
  state.calls = []
  state.tokenReads = []
})

const row = () => state.rows.get('lamp')!
const write = (change: Partial<Row>) =>
  Object.assign(row(), { updatedAt: row().updatedAt + 1 }, change)
/** A full load: the proxy's check runs and its answer reaches the page. */
const proxyAnswer = () =>
  row().published ? `found ${row().id}:${row().updatedAt}` : 'missing'
const read = async () =>
  ((await getPublishedArticle('writer', 'lamp')) as { text?: string } | null)
    ?.text ?? null

test('a cached copy serves only its own version', async () => {
  state.routeHeader = proxyAnswer()
  expect(await read()).toBe('First text')
  expect(await read()).toBe('First text')
  expect(state.reads).toBe(1)
  // Edited, then replaced by another article at the same slug.
  write({ text: 'Edited text' })
  state.routeHeader = proxyAnswer()
  expect(await read()).toBe('Edited text')
  write({ id: 'b2', text: 'Another article' })
  state.routeHeader = proxyAnswer()
  expect(await read()).toBe('Another article')
})

test('a hidden article is not served, and comes back only when published', async () => {
  state.routeHeader = proxyAnswer()
  expect(await read()).toBe('First text')
  write({ published: false })
  state.routeHeader = proxyAnswer()
  expect(await read()).toBeNull()
  write({ published: true })
  state.routeHeader = proxyAnswer()
  expect(await read()).toBe('First text')
})

test('when the check could not run, the page reads directly', async () => {
  state.routeHeader = 'unknown'
  expect(await read()).toBe('First text')
  state.routeHeader = proxyAnswer()
  expect(await read()).toBe('First text')
  // Hidden while the check cannot run: no cached copy is used.
  write({ published: false })
  state.routeHeader = 'unknown'
  expect(await read()).toBeNull()
  expect(state.reads).toBe(3)
})

test('without a header the page runs the check itself', async () => {
  expect(await read()).toBe('First text')
  write({ published: false })
  expect(await read()).toBeNull()
})

// #679: the article read gives the writer their own upload state only with
// their auth token. The cached copy serves every visitor, so the server read
// that fills it must never send one: then `isOwner` is false on that path and
// only the reader view can be cached.
test('the server read of an article sends no auth token, cached or not', async () => {
  state.routeHeader = proxyAnswer()
  expect(await read()).toBe('First text')
  state.routeHeader = 'unknown'
  expect(await read()).toBe('First text')
  state.routeHeader = null
  expect(await read()).toBe('First text')
  expect(state.reads).toBeGreaterThan(0)
  expect(state.tokenReads).toEqual([])
  // publicQuery(limitMs, query, args): nothing after the arguments, and no
  // token among them.
  expect(state.calls.length).toBeGreaterThan(0)
  for (const call of state.calls) {
    expect(call).toHaveLength(3)
    expect(call[2]).not.toHaveProperty('token')
  }
})

test('publicQuery sends no Authorization header and no token', async () => {
  const { publicQuery } = await vi.importActual<
    typeof import('../../lib/seo/publicQuery')
  >('../../lib/seo/publicQuery')
  const sent: { headers: Headers; body: string }[] = []
  vi.stubEnv('NEXT_PUBLIC_CONVEX_URL', 'http://127.0.0.1:3210')
  vi.stubGlobal('fetch', async (_url: unknown, init: RequestInit) => {
    sent.push({
      headers: new Headers(init.headers),
      body: String(init.body),
    })
    return new Response(
      JSON.stringify({ status: 'success', value: null, logLines: [] }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    )
  })
  const { api } = await import('../../convex/_generated/api')
  await publicQuery(1000, api.articles.getArticleBySlug, {
    username: 'writer',
    slug: 'lamp',
  })
  expect(sent).toHaveLength(1)
  expect(sent[0]!.headers.has('authorization')).toBe(false)
  expect(sent[0]!.body).not.toMatch(/token/i)
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

test('the public server reads in lib/seo take no token', () => {
  const read = (file: string) =>
    readFileSync(path.join(import.meta.dirname, '../../lib/seo', file), 'utf8')
  const content = read('publicContent.ts')
  const query = read('publicQuery.ts')
  // No import that reads with the visitor's token.
  for (const source of [content, query]) {
    expect(source).not.toMatch(/from ['"]convex\/nextjs['"]/)
    expect(source).not.toMatch(/@convex-dev\/auth\/nextjs/)
    expect(source).not.toMatch(/\bsetAuth\(|\btoken\s*:|Authorization/)
  }
  // publicQuery(limitMs, query, args): three arguments, never a fourth.
  const calls = content.split('publicQuery(').slice(1)
  expect(calls.length).toBeGreaterThanOrEqual(6)
  for (const call of calls) {
    // The call's own parentheses: its arguments end where depth returns to 0.
    let depth = 1
    let end = 0
    while (depth > 0 && end < call.length) {
      const ch = call[end]!
      if (ch === '(' || ch === '{' || ch === '[') depth += 1
      if (ch === ')' || ch === '}' || ch === ']') depth -= 1
      end += 1
    }
    const args = call.slice(0, end - 1)
    // Top-level commas only.
    let level = 0
    let commas = 0
    for (const ch of args) {
      if (ch === '(' || ch === '{' || ch === '[') level += 1
      else if (ch === ')' || ch === '}' || ch === ']') level -= 1
      else if (ch === ',' && level === 0) commas += 1
    }
    const trailing = args.trimEnd().endsWith(',') ? 1 : 0
    expect(commas - trailing, `publicQuery(${args.slice(0, 60)}…`).toBe(2)
  }
})
