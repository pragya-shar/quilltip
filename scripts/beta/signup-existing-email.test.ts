/// <reference types="vite/client" />
// Sign-up with an email that already has an account. Runs against the real
// auth functions in convex-test (in memory), with synthetic accounts;
// nothing reaches a deployment.
import { convexTest } from 'convex-test'
import { ConvexError } from 'convex/values'
import { exportJWK, exportPKCS8, generateKeyPair } from 'jose'
import { beforeAll, describe, expect, test } from 'vitest'
import schema from '../../convex/schema'
import { api } from '../../convex/_generated/api'
import {
  SIGN_UP_GLOBAL_LIMIT,
  SIGN_UP_PER_EMAIL_LIMIT,
} from '../../convex/auth'

const modules = import.meta.glob('../../convex/**/*.ts')
const newTest = () => convexTest(schema, modules)
type T = ReturnType<typeof newTest>

const EMAIL = 'reader@example.test'
const PASSWORD = 'RightPassword1'
const WRONG = (i: number) => `WrongPassword${i}`
const EMAIL_IN_USE = { error: 'EMAIL_IN_USE' }
const LIMITED = { error: 'SIGN_UP_RATE_LIMITED' }
const HOUR = 60 * 60 * 1000

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

type Outcome = { tokens: boolean; subject?: string } | { error: string }

/** The `sub` claim of a session token: "<userId>|<sessionId>". */
function subjectOf(token: string): string {
  const payload = token.split('.')[1] ?? ''
  const json = atob(payload.replace(/-/g, '+').replace(/_/g, '/'))
  return String((JSON.parse(json) as { sub: string }).sub)
}

/** One `auth:signIn` call, reduced to "tokens" or the error it gave. */
async function attempt(t: T, params: Record<string, string>): Promise<Outcome> {
  try {
    const result = await t.action(api.auth.signIn, {
      provider: 'password',
      params,
    })
    const token = result.tokens?.token
    return token
      ? { tokens: true, subject: subjectOf(token) }
      : { tokens: false }
  } catch (error) {
    if (error instanceof ConvexError) return { error: String(error.data) }
    // A plain Error: production redacts its text to "Server Error".
    return { error: `plain: ${(error as Error).message}` }
  }
}

const signUp = (t: T, password: string, email = EMAIL) =>
  attempt(t, { email, password, flow: 'signUp' })
const signIn = (t: T, password: string, email = EMAIL) =>
  attempt(t, { email, password, flow: 'signIn' })
const gotTokens = (o: Outcome) => 'tokens' in o && o.tokens
const subject = (o: Outcome) => (o as { subject: string }).subject
const userOf = (o: Outcome) => subject(o).split('|')[0]

async function withAccount() {
  const t = newTest()
  expect(gotTokens(await signUp(t, PASSWORD))).toBe(true)
  return t
}

/** Moves every fixed window back an hour, as if the time had passed. */
async function windowsPass(t: T) {
  await t.run(async (ctx) => {
    for (const row of await ctx.db.query('rateLimits').collect()) {
      await ctx.db.patch(row._id, { windowStart: Date.now() - HOUR })
    }
  })
}

describe('sign-up with an existing email', () => {
  test('an existing email gets one answer over many sign-up attempts', async () => {
    const t = await withAccount()
    for (let i = 0; i < 8; i++) {
      expect(await signUp(t, WRONG(i))).toEqual(EMAIL_IN_USE)
    }
    expect(await signUp(t, PASSWORD)).toEqual(EMAIL_IN_USE)
  })

  test('an existing email gets one answer after the sign-in limit is reached', async () => {
    const t = await withAccount()
    for (let i = 0; i < 10; i++) await signIn(t, WRONG(i))
    expect(gotTokens(await signIn(t, PASSWORD))).toBe(false)
    expect(await signUp(t, PASSWORD)).toEqual(EMAIL_IN_USE)
  })

  test('a wrong and a right password get the same answer', async () => {
    const t = await withAccount()
    const wrong = await signUp(t, WRONG(1))
    const right = await signUp(t, PASSWORD)
    expect(wrong).toEqual(EMAIL_IN_USE)
    expect(right).toEqual(wrong)
  })

  test('the refusal spends no sign-in attempt; sign-in still works', async () => {
    const t = await withAccount()
    for (let i = 0; i < 4; i++) await signUp(t, WRONG(i))
    expect(
      await t.run((ctx) => ctx.db.query('authRateLimits').collect())
    ).toEqual([])
    expect(gotTokens(await signIn(t, PASSWORD))).toBe(true)
  })

  test('a case variant of an existing email never opens that account', async () => {
    const t = await withAccount()
    const original = await signIn(t, PASSWORD)
    // The provider's account id is the email as given, so a variant is a
    // different account: it is created, never compared with the original.
    const variant = await signUp(t, PASSWORD, 'Reader@example.test')
    expect(gotTokens(variant)).toBe(true)
    expect(userOf(variant)).not.toBe(userOf(original))
  })
})

describe('ordinary flows still work', () => {
  test('a new email signs up, signs out and signs in again', async () => {
    const t = newTest()
    const created = await signUp(t, PASSWORD, 'new@example.test')
    expect(gotTokens(created)).toBe(true)
    const sessionId = subject(created).split('|')[1]
    await t
      .withIdentity({
        subject: subject(created),
        tokenIdentifier: `test|${subject(created)}`,
      })
      .action(api.auth.signOut, {})
    const sessions = await t.run((ctx) =>
      ctx.db.query('authSessions').collect()
    )
    expect(sessions.map((s) => String(s._id))).not.toContain(sessionId)
    const again = await signIn(t, PASSWORD, 'new@example.test')
    expect(gotTokens(again)).toBe(true)
    expect(userOf(again)).toBe(userOf(created))
  })

  test('the sign-in limit holds, and recovers with time', async () => {
    const t = await withAccount()
    for (let i = 0; i < 10; i++) await signIn(t, WRONG(i))
    expect(await signIn(t, PASSWORD)).toEqual({
      error: 'plain: TooManyFailedAttempts',
    })
    await t.run(async (ctx) => {
      for (const row of await ctx.db.query('authRateLimits').collect()) {
        await ctx.db.patch(row._id, { lastAttemptTime: Date.now() - HOUR })
      }
    })
    expect(gotTokens(await signIn(t, PASSWORD))).toBe(true)
  })
})

describe('sign-up attempts', () => {
  test('the per-email limit applies with and without an account, and recovers', async () => {
    const t = await withAccount()
    // The account's own sign-up counted once.
    for (let i = 1; i < SIGN_UP_PER_EMAIL_LIMIT; i++) {
      expect(await signUp(t, WRONG(i))).toEqual(EMAIL_IN_USE)
    }
    expect(await signUp(t, PASSWORD)).toEqual(LIMITED)
    // Case and spacing variants share the count.
    expect(await signUp(t, PASSWORD, ' Reader@Example.test ')).toEqual(LIMITED)

    // An email without an account: the same answer once its count is used.
    const fresh = 'fresh@example.test'
    for (let i = 0; i < SIGN_UP_PER_EMAIL_LIMIT; i++) {
      // A password that breaks the rule is refused, and counted.
      expect(await signUp(t, 'short', fresh)).toEqual({
        error: 'INVALID_PASSWORD',
      })
    }
    expect(await signUp(t, PASSWORD, fresh)).toEqual(LIMITED)
    // The sign-up limit never touches sign-in.
    expect(gotTokens(await signIn(t, PASSWORD))).toBe(true)

    await windowsPass(t)
    expect(await signUp(t, PASSWORD)).toEqual(EMAIL_IN_USE)
    expect(gotTokens(await signUp(t, PASSWORD, fresh))).toBe(true)
  })

  test('the global limit applies to every email, and recovers', async () => {
    const t = await withAccount()
    await t.run(async (ctx) => {
      const row = await ctx.db
        .query('rateLimits')
        .withIndex('by_key', (q) => q.eq('key', 'sign-up:global'))
        .unique()
      await ctx.db.patch(row!._id, { count: SIGN_UP_GLOBAL_LIMIT })
    })
    expect(await signUp(t, PASSWORD)).toEqual(LIMITED)
    expect(await signUp(t, PASSWORD, 'new@example.test')).toEqual(LIMITED)
    expect(gotTokens(await signIn(t, PASSWORD))).toBe(true)
    await windowsPass(t)
    expect(gotTokens(await signUp(t, PASSWORD, 'new@example.test'))).toBe(true)
  })
})
