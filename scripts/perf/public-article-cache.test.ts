import { beforeEach, expect, test, vi } from 'vitest'
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
} = { rows: new Map(), routeHeader: null, reads: 0 }
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
vi.mock('convex/nextjs', () => ({
  fetchQuery: async (ref: never, args: { slug: string }) => {
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

const { getPublishedArticle } = await import('../../lib/seo/publicContent')

beforeEach(() => {
  store.clear()
  state.rows = new Map([
    ['lamp', { id: 'a1', updatedAt: 1, published: true, text: 'First text' }],
  ])
  state.routeHeader = null
  state.reads = 0
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
