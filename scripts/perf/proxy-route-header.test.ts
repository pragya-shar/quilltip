import { afterAll, beforeAll, expect, test } from 'vitest'
import { NextRequest } from 'next/server'
import { proxy } from '../../proxy'
import { ARTICLE_ROUTE_HEADER } from '../../lib/seo/articleRoute'

/**
 * The proxy hands the page the request headers it passes on; Next.js then
 * replaces the incoming headers with exactly that set (`x-middleware-override-
 * headers` lists them, `x-middleware-request-<name>` carries each value). A
 * client's copy of the internal route header must never be in it.
 */

const FORGED = 'found forged:1'
const passed = (response: Response) => ({
  names: (response.headers.get('x-middleware-override-headers') ?? '').split(
    ','
  ),
  route: response.headers.get(`x-middleware-request-${ARTICLE_ROUTE_HEADER}`),
})

// No backend: the writer and article checks fail fast and count as unknown.
const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL
beforeAll(() => {
  process.env.NEXT_PUBLIC_CONVEX_URL = 'http://127.0.0.1:9'
})
afterAll(() => {
  process.env.NEXT_PUBLIC_CONVEX_URL = convexUrl
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

test.each(['/articles', '/login', '/fixture-writer', '/'])(
  'a full load of %s passes on no route header',
  async (path) => {
    const { names, route } = passed(await load(path))
    // The proxy did pass the request's headers on, just not this one.
    expect(names).toContain('accept')
    expect(names).not.toContain(ARTICLE_ROUTE_HEADER)
    expect(route).toBeNull()
  }
)

test("an article load passes on only the proxy's own answer", async () => {
  const { names, route } = passed(await load('/fixture-writer/an-article'))
  expect(names).toContain(ARTICLE_ROUTE_HEADER)
  // The check could not reach a backend, so the page must read directly.
  expect(route).toBe('unknown')
})

test('a request marked as RSC passes on no route header', async () => {
  const { names, route } = passed(
    await load('/fixture-writer/an-article', { rsc: '1' })
  )
  expect(names).not.toContain(ARTICLE_ROUTE_HEADER)
  expect(route).toBeNull()
})
