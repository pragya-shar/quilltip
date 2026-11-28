import { ConvexError } from 'convex/values'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { api } from '../../convex/_generated/api'
import { isPausedDeploymentMessage } from '../../lib/convex/pausedDeployment'
import {
  BackendUnavailable,
  countsAsOutage,
  publicQuery,
} from '../../lib/seo/publicQuery'
import { NEAR_MISS_BODY, PAUSED_BODY } from './paused-deployment-fixture'

/**
 * A paused Convex deployment (#609): HTTP 200 with an error body. The text
 * decides, narrowly: on the proxy's path and the page's server reads it
 * counts as an outage. (A page already open is not covered: its first
 * subscription that reports the pause still throws into the error screen.)
 */

// The page reads: a request-scoped memo and the request headers, with no
// proxy answer (the page asks for itself), and a pass-through cache.
vi.mock('react', async (original) => ({
  ...(await original<typeof import('react')>()),
  cache: <T>(fn: T) => fn,
}))
vi.mock('next/headers', () => ({ headers: async () => new Headers() }))
vi.mock('next/cache', () => ({
  unstable_cache:
    <A extends unknown[], R>(fn: (...args: A) => Promise<R>) =>
    (...args: A) =>
      fn(...args),
}))

const {
  getPublishedArticle,
  getPublicProfile,
  getPublicProfileArticles,
  getReadingRoomList,
  movedPublicPath,
} = await import('../../lib/seo/publicContent')

/** A function that throws the full two-line text on purpose. */
const THROWN_FULL_TEXT =
  '[Request ID: 1] Server Error\nUncaught Error: Server Error\nCannot run functions while this deployment is paused.'

/** The same text as a live subscription reports it. */
const SUBSCRIPTION_MESSAGE = `[CONVEX Q(articles:getArticleBySlug)] ${PAUSED_BODY.errorMessage}`

const backend = vi.fn()
beforeEach(() => {
  vi.stubEnv('NEXT_PUBLIC_CONVEX_URL', 'http://127.0.0.1:3299')
  vi.stubGlobal('fetch', backend)
  backend.mockReset()
  vi.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})
const answer = (body: unknown, status = 200) =>
  backend.mockImplementation(async () => Response.json(body, { status }))
const read = () =>
  publicQuery(1500, api.publicRoutes.publicRouteExists, { username: 'x' })

describe('the paused-deployment text', () => {
  it.each([
    ['the HTTP answer', PAUSED_BODY.errorMessage],
    ['a live subscription', SUBSCRIPTION_MESSAGE],
    [
      'no prefix',
      'Server Error\nCannot run functions while this deployment is paused.',
    ],
  ])('matches %s', (_, message) => {
    expect(isPausedDeploymentMessage(message)).toBe(true)
  })

  it.each([
    ['another error', NEAR_MISS_BODY.errorMessage],
    [
      'a function that throws the same words',
      '[Request ID: 1] Server Error\nUncaught Error: Cannot run functions while this deployment is paused.',
    ],
    ['a function that throws the full two-line text', THROWN_FULL_TEXT],
    [
      'the sentence without the Server Error line',
      'Cannot run functions while this deployment is paused.',
    ],
    ['empty', ''],
  ])('does not match %s', (_, message) => {
    expect(isPausedDeploymentMessage(message)).toBe(false)
  })
})

describe('publicQuery', () => {
  it('counts the measured paused answer as an outage', async () => {
    answer(PAUSED_BODY)
    const error = await read().catch((e: unknown) => e)
    expect(error).toBeInstanceOf(BackendUnavailable)
    expect(countsAsOutage(error)).toBe(true)
  })

  it('does not count a near miss: same status and shape, another message', async () => {
    answer(NEAR_MISS_BODY)
    const error = await read().catch((e: unknown) => e)
    expect(error).not.toBeInstanceOf(BackendUnavailable)
    expect(countsAsOutage(error)).toBe(false)
  })

  it('does not count a function that throws the full two-line text', async () => {
    answer({ status: 'error', errorMessage: THROWN_FULL_TEXT })
    const error = await read().catch((e: unknown) => e)
    expect(error).toBeInstanceOf(Error)
    expect(error).not.toBeInstanceOf(BackendUnavailable)
    expect(countsAsOutage(error)).toBe(false)
  })

  it('does not count a ConvexError that carries the paused text', async () => {
    // A function's own ConvexError: the body has `errorData`.
    answer({ ...PAUSED_BODY, errorData: { reason: 'paused' } })
    const error = await read().catch((e: unknown) => e)
    expect(error).toBeInstanceOf(ConvexError)
    expect(error).not.toBeInstanceOf(BackendUnavailable)
    expect(countsAsOutage(error)).toBe(false)
  })

  it('still reads a normal answer', async () => {
    answer({ status: 'success', value: false, logLines: [] })
    await expect(read()).resolves.toBe(false)
  })
})

describe('the page’s reads on a paused deployment', () => {
  it('give the readable fallback (undefined), never "missing" (null)', async () => {
    answer(PAUSED_BODY)
    await expect(getPublishedArticle('writer', 'lamp')).resolves.toBeUndefined()
    await expect(getPublicProfile('writer')).resolves.toBeUndefined()
    await expect(
      getReadingRoomList({ page: 1, limit: 9 })
    ).resolves.toBeUndefined()
    await expect(getPublicProfileArticles('writer', 1)).resolves.toBeUndefined()
    // The moved-handle lookup could not run: the fallback, never a 404.
    await expect(movedPublicPath('writer', 'lamp', {})).resolves.toBeUndefined()
  })
})
