import { afterEach, beforeEach, expect, test, vi } from 'vitest'

const ID = '0b7e3a52-8c1f-4d2e-9a6b-3f4c5d6e7f80'
const upstream = vi.fn(async () => new Response(null, { status: 200 }))

async function loadRoute() {
  vi.resetModules()
  return import('../../app/api/analytics/route')
}

function post(body: unknown, headers: Record<string, string> = {}) {
  return new Request('https://quilltip.test/api/analytics', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  })
}

function sentBody() {
  const call = upstream.mock.calls[0] as unknown as [string, RequestInit]
  return { url: call[0], body: JSON.parse(String(call[1].body)) }
}

beforeEach(() => {
  upstream.mockClear()
  vi.stubGlobal('fetch', upstream)
})
afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

test('relay is off without the public flag or the server key', async () => {
  vi.stubEnv('NEXT_PUBLIC_ANALYTICS_ENABLED', 'true')
  vi.stubEnv('ANALYTICS_POSTHOG_KEY', '')
  let { POST } = await loadRoute()
  expect(
    (await POST(post({ event: '$pageview', distinctId: ID }))).status
  ).toBe(204)
  vi.stubEnv('NEXT_PUBLIC_ANALYTICS_ENABLED', 'false')
  vi.stubEnv('ANALYTICS_POSTHOG_KEY', 'phc_test')
  ;({ POST } = await loadRoute())
  expect(
    (await POST(post({ event: '$pageview', distinctId: ID }))).status
  ).toBe(204)
  expect(upstream).not.toHaveBeenCalled()
})

test('relay forwards only known events and allowed properties to a fixed path', async () => {
  vi.stubEnv('NEXT_PUBLIC_ANALYTICS_ENABLED', 'true')
  vi.stubEnv('ANALYTICS_POSTHOG_KEY', 'phc_test')
  const { POST } = await loadRoute()
  const response = await POST(
    post(
      {
        event: 'feedback_sent',
        distinctId: ID,
        path: '/dashboard/feedback?from=/write?id=draft#x',
        properties: {
          category: 'idea',
          email: 'reader@example.test',
          wallet: 'G'.repeat(56),
          $ip: '203.0.113.9',
        },
      },
      { 'sec-fetch-site': 'same-origin', origin: 'https://quilltip.test' }
    )
  )
  expect(response.status).toBe(204)
  const { url, body } = sentBody()
  expect(url).toBe('https://eu.i.posthog.com/i/v0/e/')
  expect(body).toEqual({
    api_key: 'phc_test',
    event: 'feedback_sent',
    distinct_id: ID,
    properties: {
      category: 'idea',
      $current_url: '/dashboard/feedback',
      $pathname: '/dashboard/feedback',
      $process_person_profile: false,
      $ip: null,
    },
  })
})

test('relay rejects unknown events, bad ids, cross-site and oversized requests', async () => {
  vi.stubEnv('NEXT_PUBLIC_ANALYTICS_ENABLED', 'true')
  vi.stubEnv('ANALYTICS_POSTHOG_KEY', 'phc_test')
  const { POST } = await loadRoute()
  expect(
    (await POST(post({ event: '$identify', distinctId: ID }))).status
  ).toBe(400)
  expect(
    (
      await POST(
        post({ event: '$pageview', distinctId: 'reader@example.test' })
      )
    ).status
  ).toBe(400)
  expect((await POST(post('not json'))).status).toBe(400)
  expect((await POST(post('null'))).status).toBe(400)
  expect(
    (
      await POST(
        post(
          { event: '$pageview', distinctId: ID },
          { origin: 'https://elsewhere.example' }
        )
      )
    ).status
  ).toBe(403)
  expect(
    (
      await POST(
        post(
          { event: '$pageview', distinctId: ID },
          { 'sec-fetch-site': 'cross-site' }
        )
      )
    ).status
  ).toBe(403)
  expect(
    (
      await POST(
        post({ event: '$pageview', distinctId: ID, pad: 'x'.repeat(100_000) })
      )
    ).status
  ).toBe(413)
  expect(upstream).not.toHaveBeenCalled()
})

test('relay replaces protocol-relative and missing paths with the root', async () => {
  vi.stubEnv('NEXT_PUBLIC_ANALYTICS_ENABLED', 'true')
  vi.stubEnv('ANALYTICS_POSTHOG_KEY', 'phc_test')
  const { POST } = await loadRoute()
  await POST(
    post({ event: '$pageview', distinctId: ID, path: '//evil.example/x' })
  )
  expect(sentBody().body.properties.$pathname).toBe('/')
})
