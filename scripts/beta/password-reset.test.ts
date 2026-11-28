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

// Runs a sign-in action, then lets any scheduled reset email go out.
async function signIn(t: T, params: Record<string, string>) {
  const result = await t.action(api.auth.signIn, {
    provider: 'password',
    params,
  })
  await flush(t)
  return result
}

async function flush(t: T) {
  await new Promise((resolve) => setTimeout(resolve, 0))
  await t.finishInProgressScheduledFunctions()
}

async function signUp(t: T, email = EMAIL) {
  return await signIn(t, { email, password: OLD_PASSWORD, flow: 'signUp' })
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
    `https://app.example.test/signin/reset#code=${lastCode()}`
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
  expect(
    await t.run((ctx) => ctx.db.query('authVerificationCodes').collect())
  ).toEqual([])
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

test('a reset request does not wait for email delivery', async () => {
  const t = newTest()
  await signUp(t)
  let release: (response: Response) => void = () => undefined
  vi.stubGlobal(
    'fetch',
    vi.fn(() => new Promise<Response>((resolve) => (release = resolve)))
  )
  // Delivery never finishes here, yet the request answers like any other.
  const known = await t.action(api.auth.signIn, {
    provider: 'password',
    params: { email: EMAIL, flow: 'reset' },
  })
  const unknown = await t.action(api.auth.signIn, {
    provider: 'password',
    params: { email: 'nobody@example.test', flow: 'reset' },
  })
  expect(known).toEqual(unknown)
  await new Promise((resolve) => setTimeout(resolve, 0))
  release(new Response('{}', { status: 200 }))
  await t.finishInProgressScheduledFunctions()
})

test('the reset link always uses SITE_URL', async () => {
  const t = newTest()
  await signUp(t)
  // A foreign redirect is refused, and nothing is sent.
  const refused = await signIn(t, {
    email: EMAIL,
    flow: 'reset',
    redirectTo: 'https://attacker.example/steal',
  })
  expect(refused).toEqual(
    await signIn(t, { email: 'nobody@example.test', flow: 'reset' })
  )
  expect(sent).toEqual([])
  // A same-site redirect does not change the link either.
  await signIn(t, { email: EMAIL, flow: 'reset', redirectTo: '/elsewhere' })
  const text = sent.at(-1)?.text ?? ''
  expect(text).toContain(
    `https://app.example.test/signin/reset#code=${lastCode()}`
  )
  expect(text).not.toContain('elsewhere')
  expect(text).not.toContain('?code=')
})

test('a reset signs out every other session and revokes refresh tokens', async () => {
  const t = newTest()
  const first = await signUp(t)
  const second = await signIn(t, {
    email: EMAIL,
    password: OLD_PASSWORD,
    flow: 'signIn',
  })
  expect(first.tokens?.refreshToken).toBeTruthy()
  expect(second.tokens?.refreshToken).toBeTruthy()
  const before = await t.run((ctx) => ctx.db.query('authSessions').collect())
  expect(before).toHaveLength(2)

  await signIn(t, { email: EMAIL, flow: 'reset' })
  await signIn(t, {
    email: EMAIL,
    code: lastCode()!,
    newPassword: NEW_PASSWORD,
    flow: 'reset-verification',
  })

  const sessions = await t.run((ctx) => ctx.db.query('authSessions').collect())
  expect(sessions).toHaveLength(1)
  expect(before.map((s) => s._id)).not.toContain(sessions[0]!._id)
  const tokens = await t.run((ctx) =>
    ctx.db.query('authRefreshTokens').collect()
  )
  expect(tokens.every((row) => row.sessionId === sessions[0]!._id)).toBe(true)

  // Old refresh tokens no longer mint sessions.
  for (const old of [first, second]) {
    const refreshed = await t.action(api.auth.signIn, {
      refreshToken: old.tokens!.refreshToken,
    })
    expect(refreshed.tokens).toBeNull()
  }
})

test('wrong codes lock the email out, even for the right code', async () => {
  const t = newTest()
  await signUp(t)
  await signIn(t, { email: EMAIL, flow: 'reset' })
  const code = lastCode()!
  const wrong = code === '00000000' ? '11111111' : '00000000'
  for (let i = 0; i < 10; i++) {
    expect(
      await errorData(
        signIn(t, {
          email: EMAIL,
          code: wrong,
          newPassword: NEW_PASSWORD,
          flow: 'reset-verification',
        })
      )
    ).toBe('PASSWORD_RESET_INVALID_CODE')
  }
  // Locked: the right code gets the same answer, and nothing changes.
  expect(
    await errorData(
      signIn(t, {
        email: EMAIL,
        code,
        newPassword: NEW_PASSWORD,
        flow: 'reset-verification',
      })
    )
  ).toBe('PASSWORD_RESET_INVALID_CODE')
  expect(
    (await signIn(t, { email: EMAIL, password: OLD_PASSWORD, flow: 'signIn' }))
      .tokens
  ).toBeTruthy()
})

test('a code only works for the account it was sent to', async () => {
  const t = newTest()
  const other = 'other@example.test'
  await signUp(t)
  await signUp(t, other)
  await signIn(t, { email: EMAIL, flow: 'reset' })
  const code = lastCode()!
  expect(
    await errorData(
      signIn(t, {
        email: other,
        code,
        newPassword: NEW_PASSWORD,
        flow: 'reset-verification',
      })
    )
  ).toBe('PASSWORD_RESET_INVALID_CODE')
  // The other account keeps its password, and the code still works for its owner.
  expect(
    (await signIn(t, { email: other, password: OLD_PASSWORD, flow: 'signIn' }))
      .tokens
  ).toBeTruthy()
  expect(
    (
      await signIn(t, {
        email: EMAIL,
        code,
        newPassword: NEW_PASSWORD,
        flow: 'reset-verification',
      })
    ).tokens
  ).toBeTruthy()
})

test('reset requests are limited overall', async () => {
  const t = newTest()
  for (let i = 0; i < 50; i++) {
    await signIn(t, { email: `reader${i}@example.test`, flow: 'reset' })
  }
  expect(
    await errorData(
      signIn(t, { email: 'reader50@example.test', flow: 'reset' })
    )
  ).toBe('PASSWORD_RESET_RATE_LIMITED')
})

test('codes and addresses never reach the logs', async () => {
  const t = newTest()
  const lines: string[] = []
  const spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map(
    (level) =>
      vi.spyOn(console, level).mockImplementation((...args: unknown[]) => {
        lines.push(JSON.stringify(args))
      })
  )
  try {
    await signUp(t)
    await signIn(t, { email: EMAIL, flow: 'reset' })
    const code = lastCode()!
    await signIn(t, { email: 'nobody@example.test', flow: 'reset' })
    await errorOf(
      signIn(t, {
        email: EMAIL,
        code: '12345678',
        newPassword: NEW_PASSWORD,
        flow: 'reset-verification',
      })
    )
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('nope', { status: 500 }))
    )
    await signIn(t, { email: EMAIL, flow: 'reset' })
    await signIn(t, {
      email: EMAIL,
      code,
      newPassword: NEW_PASSWORD,
      flow: 'reset-verification',
    }).catch(() => undefined)
    const output = lines.join('\n')
    expect(output).not.toContain(code)
    expect(output).not.toContain(EMAIL)
    expect(output).not.toContain('test-key')
  } finally {
    for (const spy of spies) spy.mockRestore()
  }
})
