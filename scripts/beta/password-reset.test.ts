/// <reference types="vite/client" />
import { convexTest } from 'convex-test'
import { ConvexError } from 'convex/values'
import { exportJWK, exportPKCS8, generateKeyPair } from 'jose'
import { afterEach, beforeAll, beforeEach, expect, test, vi } from 'vitest'
import schema from '../../convex/schema'
import { api } from '../../convex/_generated/api'

const modules = import.meta.glob('../../convex/**/*.ts')
const newTest = () => convexTest(schema, modules)
type T = ReturnType<typeof newTest>

const EMAIL = 'writer@example.test'
const OLD_PASSWORD = 'OldPassword1'
const NEW_PASSWORD = 'NewPassword2'

beforeAll(async () => {
  const keys = await generateKeyPair('RS256', { extractable: true })
  process.env.JWT_PRIVATE_KEY = (await exportPKCS8(keys.privateKey))
    .trimEnd()
    .replace(/\n/g, ' ')
  process.env.JWKS = JSON.stringify({
    keys: [{ use: 'sig', ...(await exportJWK(keys.publicKey)) }],
  })
  process.env.CONVEX_SITE_URL = 'https://backend.example.test'
  process.env.SITE_URL = 'https://app.example.test'
})

let sent: { to: string[]; text: string }[] = []
beforeEach(() => {
  sent = []
  process.env.AUTH_RESEND_KEY = 'test-key'
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit) => {
      if (url === 'https://api.resend.com/emails') {
        sent.push(JSON.parse(String(init.body)))
        return new Response('{}', { status: 200 })
      }
      throw new Error(`Unexpected fetch ${url}`)
    })
  )
})
afterEach(() => {
  vi.unstubAllGlobals()
  delete process.env.AUTH_RESEND_KEY
})

const signIn = (t: T, params: Record<string, string>) =>
  t.action(api.auth.signIn, { provider: 'password', params })

async function signUp(t: T) {
  await signIn(t, { email: EMAIL, password: OLD_PASSWORD, flow: 'signUp' })
}

function lastCode() {
  const text = sent.at(-1)?.text ?? ''
  return /reset code is (\d{8})/.exec(text)?.[1]
}

async function errorOf(promise: Promise<unknown>) {
  return promise.then(
    () => null,
    (e: unknown) => e
  )
}

async function errorData(promise: Promise<unknown>) {
  const error = await errorOf(promise)
  expect(error).toBeInstanceOf(ConvexError)
  return (error as ConvexError<string>).data
}

test('reset requests answer the same for known and unknown emails', async () => {
  const t = newTest()
  await signUp(t)
  const known = await signIn(t, { email: EMAIL, flow: 'reset' })
  const unknown = await signIn(t, {
    email: 'nobody@example.test',
    flow: 'reset',
  })
  expect(unknown).toEqual(known)
  expect(sent).toHaveLength(1)
  expect(sent[0]?.to).toEqual([EMAIL])
  expect(lastCode()).toMatch(/^\d{8}$/)
  // The link carries the code, never the email address.
  expect(sent[0]?.text).toContain(
    `https://app.example.test/reset-password?code=${lastCode()}`
  )
  expect(sent[0]?.text).not.toContain(encodeURIComponent(EMAIL))
})

test('a valid code sets the new password once', async () => {
  const t = newTest()
  await signUp(t)
  await signIn(t, { email: EMAIL, flow: 'reset' })
  const code = lastCode()!
  const result = await signIn(t, {
    email: EMAIL,
    code,
    newPassword: NEW_PASSWORD,
    flow: 'reset-verification',
  })
  expect(result.tokens).toBeTruthy()

  // New password works, old one does not.
  expect(
    (await signIn(t, { email: EMAIL, password: NEW_PASSWORD, flow: 'signIn' }))
      .tokens
  ).toBeTruthy()
  expect(
    await errorOf(
      signIn(t, { email: EMAIL, password: OLD_PASSWORD, flow: 'signIn' })
    )
  ).toBeInstanceOf(Error)

  // The code cannot be reused.
  expect(
    await errorData(
      signIn(t, {
        email: EMAIL,
        code,
        newPassword: 'AnotherPass3',
        flow: 'reset-verification',
      })
    )
  ).toBe('PASSWORD_RESET_INVALID_CODE')
})

test('wrong codes and unknown emails get the same error', async () => {
  const t = newTest()
  await signUp(t)
  await signIn(t, { email: EMAIL, flow: 'reset' })
  for (const email of [EMAIL, 'nobody@example.test']) {
    expect(
      await errorData(
        signIn(t, {
          email,
          code: '00000000',
          newPassword: NEW_PASSWORD,
          flow: 'reset-verification',
        })
      )
    ).toBe('PASSWORD_RESET_INVALID_CODE')
  }
})

test('an expired code is rejected', async () => {
  const t = newTest()
  await signUp(t)
  await signIn(t, { email: EMAIL, flow: 'reset' })
  await t.run(async (ctx) => {
    for (const row of await ctx.db.query('authVerificationCodes').collect()) {
      await ctx.db.patch(row._id, { expirationTime: Date.now() - 1 })
    }
  })
  expect(
    await errorData(
      signIn(t, {
        email: EMAIL,
        code: lastCode()!,
        newPassword: NEW_PASSWORD,
        flow: 'reset-verification',
      })
    )
  ).toBe('PASSWORD_RESET_INVALID_CODE')
})

test('a weak new password is rejected', async () => {
  const t = newTest()
  await signUp(t)
  await signIn(t, { email: EMAIL, flow: 'reset' })
  const error = await errorOf(
    signIn(t, {
      email: EMAIL,
      code: lastCode()!,
      newPassword: 'short',
      flow: 'reset-verification',
    })
  )
  expect(error).toBeInstanceOf(ConvexError)
  expect((error as ConvexError<string>).data).toBe('INVALID_PASSWORD')
})

test('reset requests are limited per email, for every email', async () => {
  const t = newTest()
  await signUp(t)
  for (const email of [EMAIL, 'nobody@example.test']) {
    for (let i = 0; i < 3; i++) await signIn(t, { email, flow: 'reset' })
    const error = await errorOf(signIn(t, { email, flow: 'reset' }))
    expect(error).toBeInstanceOf(ConvexError)
    expect((error as ConvexError<string>).data).toBe(
      'PASSWORD_RESET_RATE_LIMITED'
    )
  }
  expect(sent).toHaveLength(3)
})

test('without email credentials the request fails honestly before any lookup', async () => {
  const t = newTest()
  await signUp(t)
  delete process.env.AUTH_RESEND_KEY
  for (const email of [EMAIL, 'nobody@example.test']) {
    const error = await errorOf(signIn(t, { email, flow: 'reset' }))
    expect(error).toBeInstanceOf(ConvexError)
    expect((error as ConvexError<string>).data).toBe(
      'PASSWORD_RESET_UNAVAILABLE'
    )
  }
  expect(sent).toEqual([])
})

test('a delivery failure looks like a normal request to the caller', async () => {
  const t = newTest()
  await signUp(t)
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response('nope', { status: 500 }))
  )
  const unknown = await signIn(t, {
    email: 'nobody@example.test',
    flow: 'reset',
  })
  expect(await signIn(t, { email: EMAIL, flow: 'reset' })).toEqual(unknown)
})
