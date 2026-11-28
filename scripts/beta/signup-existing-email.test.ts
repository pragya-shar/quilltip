/// <reference types="vite/client" />
// Sign-up with an email that already has an account. Runs against the real
// auth functions in convex-test (in memory); nothing reaches a deployment.
import { convexTest } from 'convex-test'
import { ConvexError } from 'convex/values'
import { exportJWK, exportPKCS8, generateKeyPair } from 'jose'
import { beforeAll, describe, expect, test } from 'vitest'
import schema from '../../convex/schema'
import { api } from '../../convex/_generated/api'

const modules = import.meta.glob('../../convex/**/*.ts')
const newTest = () => convexTest(schema, modules)
type T = ReturnType<typeof newTest>

const EMAIL = 'reader@example.test'
const PASSWORD = 'RightPassword1'
const WRONG = (i: number) => `WrongPassword${i}`

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

type Outcome = { tokens: boolean } | { error: string }

/** One `auth:signIn` call, reduced to "tokens" or the error it gave. */
async function attempt(t: T, params: Record<string, string>): Promise<Outcome> {
  try {
    const result = await t.action(api.auth.signIn, {
      provider: 'password',
      params,
    })
    return { tokens: Boolean(result.tokens) }
  } catch (error) {
    if (error instanceof ConvexError) return { error: String(error.data) }
    // A plain Error: production redacts its text to "Server Error".
    return { error: `plain: ${(error as Error).message}` }
  }
}

const EMAIL_IN_USE = { error: 'EMAIL_IN_USE' }
const LIMITED = { error: 'SIGN_UP_RATE_LIMITED' }
const HOUR = 60 * 60 * 1000

const signUp = (t: T, password: string, email = EMAIL) =>
  attempt(t, { email, password, flow: 'signUp' })
const signIn = (t: T, password: string, email = EMAIL) =>
  attempt(t, { email, password, flow: 'signIn' })

async function withAccount() {
  const t = newTest()
  expect(await signUp(t, PASSWORD)).toEqual({ tokens: true })
  return t
}

describe('sign-up with an existing email', () => {
  test('an existing email gets one answer over many sign-up attempts', async () => {
    const t = await withAccount()
    for (let i = 0; i < 30; i++) {
      const wrong = await signUp(t, WRONG(i))
      expect('tokens' in wrong).toBe(false)
    }
    expect(await signUp(t, PASSWORD)).not.toEqual({ tokens: true })
  })

  test('an existing email gets one answer after the sign-in limit is reached', async () => {
    const t = await withAccount()
    for (let i = 0; i < 10; i++) await signIn(t, WRONG(i))
    const locked = await signIn(t, PASSWORD)
    expect('tokens' in locked).toBe(false)
    expect(await signUp(t, PASSWORD)).not.toEqual({ tokens: true })
  })

  test('a wrong and a right password get the same answer', async () => {
    const t = await withAccount()
    const wrong = await signUp(t, WRONG(1))
    const right = await signUp(t, PASSWORD)
    expect(right).toEqual(wrong)
  })

  test('the answer is a fixed code, kept in production', async () => {
    const t = await withAccount()
    expect(await signUp(t, WRONG(1))).toEqual(EMAIL_IN_USE)
    expect(await signUp(t, PASSWORD)).toEqual(EMAIL_IN_USE)
  })

  test('the refusal spends no sign-in attempt; sign-in still works', async () => {
    const t = await withAccount()
    for (let i = 0; i < 4; i++) await signUp(t, WRONG(i))
    const limits = await t.run((ctx) =>
      ctx.db.query('authRateLimits').collect()
    )
    expect(limits).toEqual([])
    expect(await signIn(t, PASSWORD)).toEqual({ tokens: true })
  })

  test('a password that breaks the rule gets the same answer for a new and an existing email', async () => {
    const t = await withAccount()
    const existing = await signUp(t, 'short')
    const fresh = await signUp(t, 'short', 'new@example.test')
    expect(existing).toEqual({ error: 'INVALID_PASSWORD' })
    expect(fresh).toEqual(existing)
  })
})

describe('sign-up for a new email and sign-in', () => {
  test('a new email still signs up and gets a session', async () => {
    const t = newTest()
    expect(await signUp(t, PASSWORD, 'new@example.test')).toEqual({
      tokens: true,
    })
    expect(await signIn(t, PASSWORD, 'new@example.test')).toEqual({
      tokens: true,
    })
  })

  test('the sign-in lockout holds, and recovers with time', async () => {
    const t = await withAccount()
    for (let i = 0; i < 10; i++) await signIn(t, WRONG(i))
    expect(await signIn(t, PASSWORD)).toEqual({
      error: 'plain: TooManyFailedAttempts',
    })
    // An hour later the attempts are back.
    await t.run(async (ctx) => {
      for (const row of await ctx.db.query('authRateLimits').collect()) {
        await ctx.db.patch(row._id, { lastAttemptTime: Date.now() - HOUR })
      }
    })
    expect(await signIn(t, PASSWORD)).toEqual({ tokens: true })
  })
})

describe('sign-up attempts per email', () => {
  test('the limit applies to existing and new emails alike, and recovers', async () => {
    const t = await withAccount()
    // The account's own sign-up counted once.
    for (let i = 0; i < 4; i++) {
      expect(await signUp(t, WRONG(i))).toEqual(EMAIL_IN_USE)
    }
    expect(await signUp(t, PASSWORD)).toEqual(LIMITED)
    // Case and spacing variants share the count.
    expect(await signUp(t, PASSWORD, ' Reader@Example.test ')).toEqual(LIMITED)

    // A password that breaks the rule is refused before the count.
    const fresh = 'fresh@example.test'
    for (let i = 0; i < 6; i++) await signUp(t, 'short', fresh)
    expect(await signUp(t, PASSWORD, fresh)).toEqual({ tokens: true })
    // Sign-in is untouched by the sign-up limit.
    expect(await signIn(t, PASSWORD)).toEqual({ tokens: true })

    // After the window, attempts count again.
    await t.run(async (ctx) => {
      for (const row of await ctx.db.query('rateLimits').collect()) {
        await ctx.db.patch(row._id, { windowStart: Date.now() - HOUR })
      }
    })
    expect(await signUp(t, PASSWORD)).toEqual(EMAIL_IN_USE)
  })

  test('limited answers are the same with and without an account', async () => {
    const t = await withAccount()
    const fresh = 'fresh@example.test'
    for (let i = 0; i < 5; i++) {
      await signUp(t, WRONG(i))
      await t.run(async (ctx) => {
        // Count attempts for the new email without creating its account.
        const key = `sign-up:${fresh}`
        const row = await ctx.db
          .query('rateLimits')
          .withIndex('by_key', (q) => q.eq('key', key))
          .unique()
        if (row) await ctx.db.patch(row._id, { count: row.count + 1 })
        else
          await ctx.db.insert('rateLimits', {
            key,
            windowStart: Date.now(),
            count: 1,
          })
      })
    }
    expect(await signUp(t, PASSWORD)).toEqual(LIMITED)
    expect(await signUp(t, PASSWORD, fresh)).toEqual(LIMITED)
    const accounts = await t.run((ctx) =>
      ctx.db.query('authAccounts').collect()
    )
    expect(accounts.map((a) => a.providerAccountId)).toEqual([EMAIL])
  })
})
