import { expect, test } from 'vitest'
// The same functions a build uses to turn `config.matcher` into the regular
// expression it stores in .next/server/functions-config-manifest.json, and
// the server uses to decide whether a request runs the proxy.
import * as pageStaticInfo from 'next/dist/build/analysis/get-page-static-info'
import { getMiddlewareRouteMatcher } from 'next/dist/shared/lib/router/utils/middleware-route-matcher'
import { config } from '../../proxy'

// Exported at run time; its type declarations leave it out.
const { getMiddlewareMatchers } = pageStaticInfo as unknown as {
  getMiddlewareMatchers: (
    matcher: string[],
    nextConfig: object
  ) => Parameters<typeof getMiddlewareRouteMatcher>[0]
}

const runsProxy = getMiddlewareRouteMatcher(
  getMiddlewareMatchers(config.matcher, {})
)
const matches = (path: string) => runsProxy(path, {} as never, {})

test.each([
  // Writers whose handle starts with "api", and their articles.
  '/apiary',
  '/apiary/slug',
  '/api_fan/an-article',
  // Not a route: the proxy's check answers 404.
  '/api-docs',
  // Routing is case-sensitive: this is a writer page, not an API route.
  '/API/x',
  // Handles that start like the other entries.
  '/faviconXico',
  '/favicon.icon/slug',
  '/',
  '/articles',
  '/login',
])('%s runs the proxy', (path) => {
  expect(matches(path)).toBe(true)
})

test.each([
  '/api',
  '/api/x',
  '/api/health',
  '/_next/static',
  '/_next/static/chunks/app.js',
  '/_next/image',
  '/favicon.ico',
])('%s does not run the proxy', (path) => {
  expect(matches(path)).toBe(false)
})
