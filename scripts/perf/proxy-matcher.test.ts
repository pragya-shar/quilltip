import { expect, test } from 'vitest'
// The same functions a build uses to turn `config.matcher` into the regular
// expression it stores in .next/server/functions-config-manifest.json, and
// the server uses to decide whether a request runs the proxy.
import * as pageStaticInfo from 'next/dist/build/analysis/get-page-static-info'
import { getMiddlewareRouteMatcher } from 'next/dist/shared/lib/router/utils/middleware-route-matcher'
import { config } from '../../proxy'
import { handleFormatError } from '../../lib/profile/handleRules'

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

// The proxy removes a client's internal route header, so its safety rests on
// every writer path running the proxy: no first segment the matcher leaves
// out may be a handle a writer can hold.
test.each(['api', 'API', 'Api', '_next', 'favicon.ico'])(
  'the excluded first segment %s is not a valid handle',
  (segment) => {
    expect(handleFormatError(segment)).not.toBeNull()
  }
)

test.each(['apiary', 'api_fan', 'API_x', 'faviconXico'])(
  '%s is a valid handle, and its pages run the proxy',
  (handle) => {
    expect(handleFormatError(handle)).toBeNull()
    expect(matches(`/${handle}`)).toBe(true)
    expect(matches(`/${handle}/an-article`)).toBe(true)
  }
)
