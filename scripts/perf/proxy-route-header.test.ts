import { afterAll, beforeAll, expect, test, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { proxy } from '../../proxy'
import { ARTICLE_ROUTE_HEADER } from '../../lib/seo/articleRoute'

/**
 * The proxy hands the page the request headers it passes on; Next.js then
 * replaces the incoming headers with exactly that set (`x-middleware-override-
 * headers` lists them, `x-middleware-request-<name>` carries each value). A
 * client's copy of the internal route header must never be in it.
 *
 * A stand-in backend answers the checks. (An unreachable backend is an outage
 * since #609: the proxy answers 503 and passes nothing on; see
 * outage-proxy.test.ts.)
 */

const FORGED = 'found forged:1'
const passed = (response: Response) => ({
  names: (response.headers.get('x-middleware-override-headers') ?? '').split(
    ','
  ),
  route: response.headers.get(`x-middleware-request-${ARTICLE_ROUTE_HEADER}`),
})

const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL
beforeAll(() => {
  process.env.NEXT_PUBLIC_CONVEX_URL = 'http://127.0.0.1:3299'
  vi.stubGlobal(
    'fetch',
    async (_input: RequestInfo | URL, init?: RequestInit) => {
      const { path, args } = JSON.parse(String(init?.body)) as {
        path: string
        args: [{ slug?: string }]
      }
      const value =
        path === 'publicRoutes:publicRouteExists'
          ? false
          : args[0].slug
            ? { kind: 'found', version: 'a1:1' }
            : { kind: 'found' }
      return Response.json({ status: 'success', value, logLines: [] })
    }
  )
})
afterAll(() => {
  process.env.NEXT_PUBLIC_CONVEX_URL = convexUrl
  vi.unstubAllGlobals()
})

const load = (path: string, headers: Record<string, string> = {}) =>
  proxy(
    new NextRequest(`http://localhost${path}`, {
      headers: {
        accept: 'text/html',
        [ARTICLE_ROUTE_HEADER]: FORGED,
        ...headers,
      },
    })
  )

test.each(['/articles', '/login', '/dashboard/feedback', '/'])(
  'a full load of %s passes on no route header',
  async (path) => {
    const { names, route } = passed(await load(path))
    // The proxy did pass the request's headers on, just not this one.
    expect(names).toContain('accept')
    expect(names).not.toContain(ARTICLE_ROUTE_HEADER)
    expect(route).toBeNull()
  }
)

test.each([
  ['an article', '/fixture-writer/an-article', 'found a1:1'],
  // Writer pages carry the proxy's answer too since #609, without a version.
  ['a writer', '/fixture-writer', 'found'],
])("%s load passes on only the proxy's own answer", async (_, path, answer) => {
  const { names, route } = passed(await load(path))
  expect(names).toContain(ARTICLE_ROUTE_HEADER)
  expect(route).toBe(answer)
})

test.each([
  ['a navigation', { rsc: '1' }],
  ['a prefetch', { rsc: '1', 'next-router-prefetch': '1' }],
])(
  '%s request marked as RSC passes on no route header',
  async (_kind, headers) => {
    const { names, route } = passed(
      await load('/fixture-writer/an-article', headers)
    )
    expect(names).not.toContain(ARTICLE_ROUTE_HEADER)
    expect(route).toBeNull()
  }
)

test('a forged "missing" on an article load is replaced by the proxy\'s answer', async () => {
  const { route } = passed(
    await load('/fixture-writer/an-article', {
      [ARTICLE_ROUTE_HEADER]: 'missing',
    })
  )
  expect(route).toBe('found a1:1')
})
