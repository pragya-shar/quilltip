/// <reference types="vite/client" />
// Sign-up with an email that already has an account. Runs against the real
// auth functions in convex-test (in memory), with synthetic accounts;
// nothing reaches a deployment.
import { convexTest } from 'convex-test'
import { ConvexError, v } from 'convex/values'
import { exportJWK, exportPKCS8, generateKeyPair } from 'jose'
import { afterEach, beforeAll, describe, expect, test, vi } from 'vitest'
import schema from '../../convex/schema'
import { api, internal } from '../../convex/_generated/api'
import { internalMutation } from '../../convex/_generated/server'
import {
  CREATE_ONLY_PREFIX,
  SIGN_UP_CLAIM_MS,
  SIGN_UP_PER_EMAIL_LIMIT,
  signUpSecret,
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
  test('an existing email never gets a session from sign-up, over 30 attempts', async () => {
    const t = await withAccount()
    const answers = []
    for (let i = 0; i < 30; i++) answers.push(await signUp(t, WRONG(i)))
    answers.push(await signUp(t, PASSWORD))
    // Refused until the count is used up, then limited; never a session.
    for (const answer of answers) {
      expect([EMAIL_IN_USE, LIMITED]).toContainEqual(answer)
    }
    // The window passes: the right password still gets the refusal.
    await windowsPass(t)
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

  // The provider stores the email as given as the account id, and the
  // lookup uses exactly that id. A variant is a different id: the library
  // creates a separate account and never compares with the original's hash.
  test.each([['Reader@example.test'], [' reader@example.test ']])(
    'the variant %j never opens the existing account',
    async (variant) => {
      const t = await withAccount()
      const original = await signIn(t, PASSWORD)
      const answer = await signUp(t, PASSWORD, variant)
      expect(gotTokens(answer)).toBe(true)
      expect(userOf(answer)).not.toBe(userOf(original))
      const ids = await t.run(async (ctx) =>
        (await ctx.db.query('authAccounts').collect()).map(
          (a) => a.providerAccountId
        )
      )
      expect(ids.sort()).toEqual([EMAIL, variant].sort())
    }
  )
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
  test('a password that breaks the rule gets one answer for every email and spends nothing', async () => {
    const t = await withAccount()
    for (let i = 0; i < SIGN_UP_PER_EMAIL_LIMIT + 2; i++) {
      expect(await signUp(t, 'short')).toEqual({ error: 'INVALID_PASSWORD' })
      expect(await signUp(t, 'short', 'fresh@example.test')).toEqual({
        error: 'INVALID_PASSWORD',
      })
    }
    // Nothing was counted: the existing email still gets its refusal and
    // the new email still signs up.
    expect(await signUp(t, PASSWORD)).toEqual(EMAIL_IN_USE)
    expect(gotTokens(await signUp(t, PASSWORD, 'fresh@example.test'))).toBe(
      true
    )
  })

  test('the per-email limit applies with and without an account, and recovers', async () => {
    expect(SIGN_UP_PER_EMAIL_LIMIT).toBe(5)
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
    await t.run(async (ctx) => {
      await ctx.db.insert('rateLimits', {
        key: `sign-up:${fresh}`,
        windowStart: Date.now(),
        count: SIGN_UP_PER_EMAIL_LIMIT,
      })
    })
    expect(await signUp(t, PASSWORD, fresh)).toEqual(LIMITED)
    // The sign-up limit never touches sign-in.
    expect(gotTokens(await signIn(t, PASSWORD))).toBe(true)

    await windowsPass(t)
    expect(await signUp(t, PASSWORD)).toEqual(EMAIL_IN_USE)
    expect(gotTokens(await signUp(t, PASSWORD, fresh))).toBe(true)
  })

  test('there is no count across emails', async () => {
    const t = newTest()
    for (let i = 0; i < 4 * SIGN_UP_PER_EMAIL_LIMIT; i++) {
      expect(
        gotTokens(await signUp(t, PASSWORD, `user${i}@example.test`))
      ).toBe(true)
    }
    const keys = await t.run(async (ctx) =>
      (await ctx.db.query('rateLimits').collect()).map((r) => r.key)
    )
    expect(keys.every((k) => /^sign-up:user\d+@example\.test$/.test(k))).toBe(
      true
    )
  })
})

describe('two sign-ups for one new email at the same moment', () => {
  test('one account; the other is refused before any password compare', async () => {
    for (let i = 0; i < 3; i++) {
      const t = newTest()
      const email = `race${i}@example.test`
      const [first, second] = await Promise.all([
        signUp(t, PASSWORD, email),
        signUp(t, WRONG(i), email),
      ])
      expect(gotTokens(first)).toBe(true)
      expect(second).toEqual(EMAIL_IN_USE)
      // The same password too: create-only, never a sign-in through sign-up.
      const [a, b] = await Promise.all([
        signUp(t, PASSWORD, `same${email}`),
        signUp(t, PASSWORD, `same${email}`),
      ])
      expect(gotTokens(a)).toBe(true)
      expect(b).toEqual(EMAIL_IN_USE)
      const accounts = await t.run((ctx) =>
        ctx.db.query('authAccounts').collect()
      )
      expect(accounts).toHaveLength(2)
      // Every hold is released.
      const holds = await t.run(async (ctx) =>
        (await ctx.db.query('rateLimits').collect()).filter((r) =>
          r.key.startsWith('sign-up-claim:')
        )
      )
      expect(holds).toEqual([])
    }
  })

  test('a hold left by a stopped sign-up blocks only until it runs out', async () => {
    const t = newTest()
    const email = 'held@example.test'
    await t.run(async (ctx) => {
      await ctx.db.insert('rateLimits', {
        key: `sign-up-claim:${email}`,
        windowStart: Date.now(),
        count: 1,
      })
    })
    expect(await signUp(t, PASSWORD, email)).toEqual(EMAIL_IN_USE)
    await t.run(async (ctx) => {
      for (const row of await ctx.db.query('rateLimits').collect()) {
        if (row.key.startsWith('sign-up-claim:')) {
          await ctx.db.patch(row._id, {
            windowStart: Date.now() - SIGN_UP_CLAIM_MS,
          })
        }
      }
    })
    expect(gotTokens(await signUp(t, PASSWORD, email))).toBe(true)
  })
})

describe('a used-up sign-up count', () => {
  let sent: { to: string[]; text: string }[] = []
  afterEach(() => {
    vi.unstubAllGlobals()
    delete process.env.AUTH_RESEND_KEY
  })

  test('leaves sign-in and password reset working for that email', async () => {
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
    const t = await withAccount()
    for (let i = 1; i < SIGN_UP_PER_EMAIL_LIMIT; i++) await signUp(t, WRONG(i))
    expect(await signUp(t, PASSWORD)).toEqual(LIMITED)

    // Sign-in still works.
    expect(gotTokens(await signIn(t, PASSWORD))).toBe(true)

    // A reset request still sends a code, and the code sets a new password.
    await t.action(api.auth.signIn, {
      provider: 'password',
      params: { email: EMAIL, flow: 'reset' },
    })
    await new Promise((resolve) => setTimeout(resolve, 0))
    await t.finishInProgressScheduledFunctions()
    const code = /reset code is (\d{8})/.exec(sent.at(-1)?.text ?? '')?.[1]
    expect(code).toMatch(/^\d{8}$/)
    const reset = await attempt(t, {
      email: EMAIL,
      code: code!,
      newPassword: 'NewPassword2',
      flow: 'reset-verification',
    })
    expect(gotTokens(reset)).toBe(true)
    expect(gotTokens(await signIn(t, 'NewPassword2'))).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Sign-up only creates. `beginSignUp` and the library's account creation are
// separate transactions; the library's create path
// (`createAccountFromCredentialsImpl`) finds an account made in between and
// compares this sign-up's secret with it. Sign-up passes a secret that
// `verifySecret` never accepts (`signUpSecret`), so that comparison refuses.

const OTHER = 'other@example.test'

/**
 * The modules with `auth.beginSignUp` replaced: for EMAIL it moves OTHER's
 * account to EMAIL, as if another sign-up for EMAIL had committed after this
 * one's hold ran out (`SIGN_UP_CLAIM_MS`), and answers 'new' as the real
 * check did. The create-only secret is then all that stops a password check.
 */
const racingModules = {
  ...modules,
  '../../convex/auth.ts': async () => {
    const real = (await modules['../../convex/auth.ts']!()) as Record<
      string,
      unknown
    >
    return {
      ...real,
      beginSignUp: internalMutation({
        args: { email: v.string() },
        handler: async (ctx, { email }) => {
          if (email === EMAIL) {
            const other = await ctx.db
              .query('authAccounts')
              .withIndex('providerAndAccountId', (q) =>
                q.eq('provider', 'password').eq('providerAccountId', OTHER)
              )
              .unique()
            if (other) {
              await ctx.db.patch(other._id, { providerAccountId: EMAIL })
            }
          }
          return 'new' as const
        },
      }),
    }
  },
}

async function tableSizes(t: T) {
  return t.run(async (ctx) => {
    const out: Record<string, number> = {}
    for (const table of [
      'users',
      'authAccounts',
      'authSessions',
      'authRefreshTokens',
      'authVerifiers',
      'authVerificationCodes',
      'authRateLimits',
    ] as const) {
      out[table] = (await ctx.db.query(table).collect()).length
    }
    return out
  })
}

describe('sign-up only creates', () => {
  test('an account that appears after the hold, before the creation, is refused even with its password', async () => {
    const t = convexTest(schema, racingModules)
    expect(gotTokens(await signUp(t, PASSWORD, OTHER))).toBe(true)
    const before = await tableSizes(t)
    expect(await signUp(t, PASSWORD)).toEqual(EMAIL_IN_USE)
    expect(await signUp(t, WRONG(1))).toEqual(EMAIL_IN_USE)
    // No second account, user or session.
    expect(await tableSizes(t)).toEqual(before)
  })

  test('the create path compares a plain secret, and refuses the sign-up secret', async () => {
    const t = newTest()
    expect(gotTokens(await signUp(t, PASSWORD))).toBe(true)
    const create = (secret: string) =>
      t.mutation(internal.auth.store, {
        args: {
          type: 'createAccountFromCredentials',
          provider: 'password',
          account: { id: EMAIL, secret },
          profile: { email: EMAIL },
        },
      })
    // The library on its own: the right password returns the account.
    const plain = (await create(PASSWORD)) as {
      account: { providerAccountId: string }
    }
    expect(plain.account.providerAccountId).toBe(EMAIL)
    // The secret sign-up sends: refused, with the right password too.
    for (const password of [PASSWORD, WRONG(1)]) {
      await expect(create(signUpSecret(password))).rejects.toThrow(
        `Account ${EMAIL} already exists`
      )
    }
  })

  test('the stored hash is the password: it signs in; the sign-up secret does not', async () => {
    const t = newTest()
    expect(gotTokens(await signUp(t, PASSWORD))).toBe(true)
    expect(gotTokens(await signIn(t, PASSWORD))).toBe(true)
    expect(await signIn(t, signUpSecret(PASSWORD))).toEqual({
      error: 'plain: InvalidSecret',
    })
    expect(CREATE_ONLY_PREFIX.startsWith('\u0000')).toBe(true)
  })

  test('a password with NUL, or one with the sign-up prefix, is refused and counts nothing', async () => {
    const t = newTest()
    for (const password of [
      `${PASSWORD}\u0000`,
      `\u0000${PASSWORD}`,
      signUpSecret(PASSWORD),
    ]) {
      expect(await signUp(t, password, 'new@example.test')).toEqual({
        error: 'INVALID_PASSWORD',
      })
    }
    const sizes = await tableSizes(t)
    expect(sizes).toMatchObject({ users: 0, authAccounts: 0 })
    expect(
      await t.run(async (ctx) => ctx.db.query('rateLimits').collect())
    ).toEqual([])
  })

  test('a refused or limited sign-up leaves no row but its count', async () => {
    const t = newTest()
    expect(gotTokens(await signUp(t, PASSWORD))).toBe(true)
    const before = await tableSizes(t)
    for (let i = 1; i < SIGN_UP_PER_EMAIL_LIMIT; i++) {
      expect(await signUp(t, i % 2 ? PASSWORD : WRONG(i))).toEqual(EMAIL_IN_USE)
    }
    expect(await signUp(t, PASSWORD)).toEqual(LIMITED)
    expect(await tableSizes(t)).toEqual(before)
    const keys = await t.run(async (ctx) =>
      (await ctx.db.query('rateLimits').collect()).map((r) => r.key)
    )
    expect(keys).toEqual([`sign-up:${EMAIL}`])
  })

  test('the sign-up limit never limits sign-in', async () => {
    const t = newTest()
    expect(gotTokens(await signUp(t, PASSWORD))).toBe(true)
    for (let i = 0; i < SIGN_UP_PER_EMAIL_LIMIT + 2; i++) {
      await signUp(t, WRONG(i))
    }
    expect(await signUp(t, PASSWORD)).toEqual(LIMITED)
    expect(gotTokens(await signIn(t, PASSWORD))).toBe(true)
  })

  test('with the right password, no flow but signIn gives a session', async () => {
    const t = newTest()
    expect(gotTokens(await signUp(t, PASSWORD))).toBe(true)
    for (const flow of [
      'signUp',
      'signup',
      'SignUp',
      'signUp ',
      'signIn ',
      'reset-verification',
      'email-verification',
      'unknown',
      '',
    ]) {
      const result = await attempt(t, {
        email: EMAIL,
        password: PASSWORD,
        newPassword: 'OtherPassword2',
        code: '00000000',
        flow,
      })
      expect(gotTokens(result), flow).toBe(false)
    }
    // No flow above changed the password.
    expect(gotTokens(await signIn(t, PASSWORD))).toBe(true)
  })
})
