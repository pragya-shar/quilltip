/// <reference types="vite/client" />
import { convexTest } from 'convex-test'
import { ConvexError } from 'convex/values'
import { exportJWK, exportPKCS8, generateKeyPair } from 'jose'
import { beforeAll, expect, test } from 'vitest'
import schema from '../../convex/schema'
import { api } from '../../convex/_generated/api'
import {
  PASSWORD_MAX_LENGTH,
  passwordMeetsRule,
  passwordRuleMessage,
} from '../../lib/validations/password-rules'

// The password rule on the server (convex/auth.ts): at least 8 characters,
// any characters, no rule about letter kinds; the other checks stand.

const modules = import.meta.glob('../../convex/**/*.ts')
const newTest = () => convexTest(schema, modules)
type T = ReturnType<typeof newTest>

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

const signIn = (t: T, params: Record<string, string>) =>
  t.action(api.auth.signIn, { provider: 'password', params })

const signUp = (t: T, email: string, password: string) =>
  signIn(t, { email, password, flow: 'signUp' })

async function refusal(promise: Promise<unknown>) {
  const error = await promise.then(
    () => null,
    (e: unknown) => e
  )
  expect(error).toBeInstanceOf(ConvexError)
  return (error as ConvexError<string>).data
}

test('7 characters are refused, and no account is made', async () => {
  const t = newTest()
  expect(await refusal(signUp(t, 'seven@example.test', 'abcdefg'))).toBe(
    'INVALID_PASSWORD'
  )
  const users = await t.run((ctx) => ctx.db.query('users').collect())
  expect(users).toEqual([])
})

test('8 characters of one kind are enough', async () => {
  const t = newTest()
  const result = await signUp(t, 'eight@example.test', 'abcdefgh')
  expect(result.tokens).toBeTruthy()
  const again = await signIn(t, {
    email: 'eight@example.test',
    password: 'abcdefgh',
    flow: 'signIn',
  })
  expect(again.tokens).toBeTruthy()
})

test('a long passphrase with spaces is accepted', async () => {
  const t = newTest()
  const phrase = 'correct horse battery staple on a quiet train'
  expect((await signUp(t, 'phrase@example.test', phrase)).tokens).toBeTruthy()
  expect(
    (
      await signIn(t, {
        email: 'phrase@example.test',
        password: phrase,
        flow: 'signIn',
      })
    ).tokens
  ).toBeTruthy()
})

test('a password longer than the bound is refused', async () => {
  const t = newTest()
  const long = 'a'.repeat(PASSWORD_MAX_LENGTH + 1)
  expect(await refusal(signUp(t, 'long@example.test', long))).toBe(
    'INVALID_PASSWORD'
  )
})

test('an account made under the old rule signs in unchanged', async () => {
  const t = newTest()
  // Uppercase, lowercase and a number, as the old rule asked.
  const old = 'OldRule1pass'
  await signUp(t, 'older@example.test', old)
  const result = await signIn(t, {
    email: 'older@example.test',
    password: old,
    flow: 'signIn',
  })
  expect(result.tokens).toBeTruthy()
  // A wrong password is still refused.
  const wrong = await signIn(t, {
    email: 'older@example.test',
    password: 'oldrule1pass',
    flow: 'signIn',
  }).then(
    () => null,
    (e: unknown) => e
  )
  expect(wrong).toBeInstanceOf(Error)
})

test('the forms say the same rule the server holds', () => {
  expect(passwordMeetsRule('abcdefg')).toBe(false)
  expect(passwordMeetsRule('abcdefgh')).toBe(true)
  expect(passwordMeetsRule('a b c d ')).toBe(true)
  expect(passwordRuleMessage('abcdefg')).toBe('Use at least 8 characters.')
  expect(passwordRuleMessage('a'.repeat(PASSWORD_MAX_LENGTH + 1))).toBe(
    `Use at most ${PASSWORD_MAX_LENGTH} characters.`
  )
  expect(passwordRuleMessage('abcdefgh')).toBeNull()
})

// The sign-in sheet's create form, given an email that has an account,
// signs in with the password typed. Those sign-ins are the library's own,
// so they count against the same per-account limit (10 failed attempts an
// hour) as any other sign-in; sign-up's "already exists" answer is the
// library's and is unchanged.
test('sign-ins after an existing email on create are throttled like any sign-in', async () => {
  const t = newTest()
  const email = 'taken@example.test'
  const password = 'the right passphrase'
  await signUp(t, email, password)
  const failed = async (p: Promise<unknown>) =>
    p.then(
      () => false,
      () => true
    )
  for (let attempt = 0; attempt < 10; attempt++) {
    // What the form does: create first, then sign in with the same values.
    expect(await failed(signUp(t, email, `guess number ${attempt}`))).toBe(true)
    expect(
      await failed(
        signIn(t, {
          email,
          password: `guess number ${attempt}`,
          flow: 'signIn',
        })
      )
    ).toBe(true)
  }
  // The limit is spent: even the right password is refused for now.
  expect(await failed(signIn(t, { email, password, flow: 'signIn' }))).toBe(
    true
  )
})

test('the same guesses as direct sign-ins spend the same limit', async () => {
  const t = newTest()
  const email = 'direct@example.test'
  const password = 'the right passphrase'
  await signUp(t, email, password)
  for (let attempt = 0; attempt < 9; attempt++)
    await signIn(t, {
      email,
      password: `guess ${attempt}`,
      flow: 'signIn',
    }).catch(() => null)
  // Under the limit, the right password still signs in.
  expect(
    (await signIn(t, { email, password, flow: 'signIn' })).tokens
  ).toBeTruthy()
})

// Stated as it is: sign-up answers "already exists" without spending the
// sign-in limit. That answer predates the sheet; the sheet adds only
// sign-ins, which are throttled (above).
test('sign-up answers for a taken email do not spend the sign-in limit', async () => {
  const t = newTest()
  const email = 'answers@example.test'
  const password = 'the right passphrase'
  await signUp(t, email, password)
  for (let attempt = 0; attempt < 12; attempt++)
    await signUp(t, email, `guess ${attempt}`).catch(() => null)
  expect(
    (await signIn(t, { email, password, flow: 'signIn' })).tokens
  ).toBeTruthy()
})
