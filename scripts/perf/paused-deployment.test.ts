import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
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
 * decides, narrowly: on the proxy's path and the page's reads it counts as an
 * outage; on a live subscription the reader keeps what they had.
 */

// The page reads: a request-scoped memo and the request headers, with no
// proxy answer (the page asks for itself), and a pass-through cache.
const state = vi.hoisted(() => ({ liveResult: undefined as unknown }))
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
vi.mock('convex/react', async (original) => ({
  ...(await original<typeof import('convex/react')>()),
  useQueries: () => ({ result: state.liveResult }),
}))

const { getPublishedArticle, getPublicProfile, getReadingRoomList } =
  await import('../../lib/seo/publicContent')
const { keepThroughPause, useReadingQuery } =
  await import('../../hooks/convex/useReadingQuery')

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
  })
})

describe('a live subscription on a paused deployment', () => {
  const paused = new Error(SUBSCRIPTION_MESSAGE)

  it('keeps the last value, or nothing, instead of throwing', () => {
    expect(keepThroughPause(paused, { title: 'Live copy' })).toEqual({
      title: 'Live copy',
    })
    expect(keepThroughPause(paused, undefined)).toBeUndefined()
    expect(keepThroughPause({ title: 'New' }, { title: 'Old' })).toEqual({
      title: 'New',
    })
  })

  it('still throws any other error', () => {
    expect(() =>
      keepThroughPause(new Error(NEAR_MISS_BODY.errorMessage), undefined)
    ).toThrow('paused for maintenance')
  })

  // A signed-out reader on an article: the page shows the server copy until
  // live data arrives. When the subscription reports the pause, the reader
  // keeps reading that copy; nothing throws into the page's error boundary.
  function Article({ serverTitle }: { serverTitle: string }) {
    const live = useReadingQuery(api.articles.getArticleBySlug, {
      username: 'writer',
      slug: 'lamp',
    }) as { title: string } | null | undefined
    const article = live === undefined ? { title: serverTitle } : live
    return createElement('h1', null, article?.title ?? 'Not found')
  }

  it('leaves a signed-out reader on the server copy', () => {
    state.liveResult = paused
    expect(
      renderToStaticMarkup(createElement(Article, { serverTitle: 'The Lamp' }))
    ).toBe('<h1>The Lamp</h1>')
  })

  it('shows live data when it answers', () => {
    state.liveResult = { title: 'The Lamp, edited' }
    expect(
      renderToStaticMarkup(createElement(Article, { serverTitle: 'The Lamp' }))
    ).toBe('<h1>The Lamp, edited</h1>')
  })

  it('throws another subscription error, as before', () => {
    state.liveResult = new Error(NEAR_MISS_BODY.errorMessage)
    expect(() =>
      renderToStaticMarkup(createElement(Article, { serverTitle: 'The Lamp' }))
    ).toThrow('paused for maintenance')
  })
})
