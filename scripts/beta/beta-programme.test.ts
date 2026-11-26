/// <reference types="vite/client" />
import { convexTest } from 'convex-test'
import { ConvexError } from 'convex/values'
import { expect, test, vi } from 'vitest'
import schema from '../../convex/schema'
import { api, internal } from '../../convex/_generated/api'
import { markWaitlistJoined } from '../../convex/waitlist'
import { afterAccountCreatedOrUpdated } from '../../convex/auth'
import {
  internalAccountDomains,
  isInternalAccountEmail,
} from '../../convex/lib/internalAccounts'

const modules = import.meta.glob('../../convex/**/*.ts')
const newTest = () => convexTest(schema, modules)

const human = { elapsedMs: 5_000, website: '' }

async function waitlistRows(t: ReturnType<typeof newTest>) {
  return t.run((ctx) => ctx.db.query('waitlist').collect())
}

async function errorData(promise: Promise<unknown>) {
  const error = await promise.then(
    () => null,
    (e: unknown) => e
  )
  expect(error).toBeInstanceOf(ConvexError)
  return (error as ConvexError<string>).data
}

test('waitlist stores a normalized email once and answers the same way twice', async () => {
  const t = newTest()
  const first = await t.mutation(api.waitlist.join, {
    ...human,
    email: '  Reader@Example.TEST ',
    name: 'Reader',
    interest: 'Essays about rivers',
  })
  const second = await t.mutation(api.waitlist.join, {
    ...human,
    email: 'reader@example.test',
  })
  expect(first).toEqual({ ok: true })
  expect(second).toEqual(first)
  const rows = await waitlistRows(t)
  expect(rows).toHaveLength(1)
  expect(rows[0]).toMatchObject({
    email: 'reader@example.test',
    status: 'pending',
    source: 'waitlist_page',
    interest: 'Essays about rivers',
  })
})

test('waitlist rejects invalid email with a clear message', async () => {
  const t = newTest()
  expect(
    await errorData(
      t.mutation(api.waitlist.join, { ...human, email: 'not-an-email' })
    )
  ).toBe('Enter a valid email address.')
})

test('waitlist silently drops honeypot and instant submissions', async () => {
  const t = newTest()
  expect(
    await t.mutation(api.waitlist.join, {
      email: 'bot@example.test',
      website: 'https://spam.example',
      elapsedMs: 5_000,
    })
  ).toEqual({ ok: true })
  expect(
    await t.mutation(api.waitlist.join, {
      email: 'fast@example.test',
      elapsedMs: 100,
    })
  ).toEqual({ ok: true })
  expect(await waitlistRows(t)).toEqual([])
})

test('waitlist has a global rate limit on new entries', async () => {
  const t = newTest()
  for (let i = 0; i < 30; i++) {
    await t.mutation(api.waitlist.join, {
      ...human,
      email: `p${i}@example.test`,
    })
  }
  expect(
    await errorData(
      t.mutation(api.waitlist.join, { ...human, email: 'p30@example.test' })
    )
  ).toMatch(/Try again in a minute/)
  expect(await waitlistRows(t)).toHaveLength(30)
})

test('invite flow: dry run, invite, then joined on account creation', async () => {
  const t = newTest()
  await t.mutation(api.waitlist.join, {
    ...human,
    email: 'writer@example.test',
  })

  const dry = await t.mutation(internal.waitlist.invite, {
    emails: ['writer@example.test', 'missing@example.test'],
  })
  expect(dry.results).toEqual([
    { email: 'writer@example.test', result: 'would_invite' },
    { email: 'missing@example.test', result: 'not_found' },
  ])
  expect((await waitlistRows(t))[0]?.status).toBe('pending')

  await t.mutation(internal.waitlist.invite, {
    emails: ['writer@example.test'],
    apply: true,
  })
  expect((await waitlistRows(t))[0]).toMatchObject({ status: 'invited' })
  const again = await t.mutation(internal.waitlist.invite, {
    emails: ['writer@example.test'],
    apply: true,
  })
  expect(again.results[0]?.result).toBe('already_invited')

  await t.run(async (ctx) => {
    const userId = await ctx.db.insert('users', {
      email: 'Writer@example.test',
      username: 'writer',
      createdAt: 1,
      updatedAt: 1,
    })
    await markWaitlistJoined(ctx, userId, 'Writer@example.test')
  })
  const [row] = await waitlistRows(t)
  expect(row).toMatchObject({ status: 'joined' })
  expect(row?.userId).toBeDefined()

  const listed = await t.query(internal.waitlist.list, { status: 'joined' })
  expect(listed.map((entry) => entry.email)).toEqual(['writer@example.test'])
})

async function seedUser(
  t: ReturnType<typeof newTest>,
  fields: { email: string; isTestAccount?: boolean; stellarAddress?: string }
) {
  return t.run((ctx) =>
    ctx.db.insert('users', {
      username: fields.email.split('@')[0]!,
      createdAt: 1,
      updatedAt: 1,
      ...fields,
    })
  )
}

test('feedback requires sign-in, validates length and stores a clean path', async () => {
  const t = newTest()
  expect(
    await errorData(
      t.mutation(api.feedback.submit, {
        category: 'bug',
        message: 'The editor lost my paragraph.',
      })
    )
  ).toBe('Log in to send feedback.')

  const userId = await seedUser(t, { email: 'reader@example.test' })
  const reader = t.withIdentity({ subject: `${userId}|session` })
  expect(
    await errorData(
      reader.mutation(api.feedback.submit, {
        category: 'bug',
        message: 'short',
      })
    )
  ).toMatch(/at least 10 characters/)
  expect(
    await errorData(
      reader.mutation(api.feedback.submit, {
        category: 'idea',
        message: 'x'.repeat(2001),
      })
    )
  ).toMatch(/under 2,000 characters/)

  await reader.mutation(api.feedback.submit, {
    category: 'bug',
    message: '  The editor lost my paragraph.  ',
    pagePath: '/write?id=secret#top',
  })
  const rows = await t.run((ctx) => ctx.db.query('feedback').collect())
  expect(rows).toEqual([
    expect.objectContaining({
      userId,
      category: 'bug',
      message: 'The editor lost my paragraph.',
      pagePath: '/write',
      status: 'new',
    }),
  ])
  const listed = await t.query(internal.feedback.listRecent, {})
  expect(listed[0]).toMatchObject({ username: 'reader', isTestAccount: false })
})

test('feedback is rate limited per person per hour', async () => {
  vi.useFakeTimers()
  try {
    const t = newTest()
    const userId = await seedUser(t, { email: 'busy@example.test' })
    const reader = t.withIdentity({ subject: `${userId}|session` })
    const send = () =>
      reader.mutation(api.feedback.submit, {
        category: 'other',
        message: 'Another thought about the reader.',
      })
    for (let i = 0; i < 5; i++) await send()
    expect(await errorData(send())).toMatch(/Try again in 60 minutes/)
    vi.advanceTimersByTime(60 * 60 * 1000)
    await expect(send()).resolves.toEqual({ ok: true })
  } finally {
    vi.useRealTimers()
  }
})

test('test-account flag is internal-only and only the account itself sees it', async () => {
  const t = newTest()
  const userId = await seedUser(t, { email: 'qa@example.test' })
  const user = t.withIdentity({ subject: `${userId}|session` })

  // The public profile mutation has no way to set the flag.
  await expect(
    user.mutation(api.users.updateProfile, {
      // @ts-expect-error not an accepted argument
      isTestAccount: false,
    })
  ).rejects.toThrow()

  await t.mutation(internal.testAccounts.setTestAccount, {
    email: 'QA@example.test',
    isTestAccount: true,
  })
  // The public profile never carries the flag; the account itself sees it.
  const profile = await t.query(api.users.getUserByUsername, { username: 'qa' })
  expect(profile).not.toBeNull()
  expect(profile).not.toHaveProperty('isTestAccount')
  expect((await user.query(api.users.getCurrentUser, {}))?.isTestAccount).toBe(
    true
  )
  expect(await t.query(internal.testAccounts.listTestAccounts, {})).toEqual([
    { id: userId, username: 'qa', email: 'qa@example.test' },
  ])
})

test('usage metrics count real activity and exclude test accounts by default', async () => {
  const t = newTest()
  const wallet = 'G' + 'A'.repeat(55)
  const writer = await seedUser(t, {
    email: 'writer@example.test',
    stellarAddress: wallet,
  })
  const reader = await seedUser(t, { email: 'reader@example.test' })
  const qa = await seedUser(t, {
    email: 'qa@example.test',
    isTestAccount: true,
    stellarAddress: wallet,
  })
  await t.run(async (ctx) => {
    const article = (authorId: typeof writer, published: boolean) =>
      ctx.db.insert('articles', {
        slug: `a-${authorId}-${published}`,
        title: 'Words',
        content: {},
        published,
        authorId,
        authorUsername: 'x',
        createdAt: 1,
        updatedAt: 1,
      })
    const realArticle = await article(writer, true)
    await article(writer, false)
    await article(qa, true)
    const highlight = (userId: typeof writer, removedAt?: number) =>
      ctx.db.insert('highlights', {
        articleId: realArticle,
        userId,
        articleTitle: 'Words',
        articleSlug: 'words',
        articleAuthor: 'writer',
        text: 'Words',
        startOffset: 0,
        endOffset: 5,
        startContainerPath: 'p',
        endContainerPath: 'p',
        highlightId: `h-${userId}-${removedAt ?? 0}`,
        isPublic: true,
        removedAt,
        createdAt: 1,
        updatedAt: 1,
      })
    await highlight(reader)
    await highlight(reader, 5)
    await highlight(qa)
    const tip = (
      tipperId: typeof writer,
      status: string,
      verifiedAt?: number
    ) =>
      ctx.db.insert('tips', {
        articleId: realArticle,
        tipperId,
        authorId: writer,
        articleTitle: 'Words',
        articleSlug: 'words',
        amountUsd: 1,
        amountCents: 100,
        status,
        verifiedAt,
        createdAt: 1,
        updatedAt: 1,
      })
    await tip(reader, 'CONFIRMED', 10)
    await tip(reader, 'CONFIRMED')
    await tip(reader, 'FAILED')
    await tip(qa, 'CONFIRMED', 10)
    await ctx.db.insert('waitlist', {
      email: 'w@example.test',
      status: 'invited',
      createdAt: 1,
    })
  })

  const metrics = await t.action(internal.betaMetrics.getUsageMetrics, {})
  expect(metrics).toMatchObject({
    excludeTestAccounts: true,
    testAccountsExcluded: 1,
    users: { total: 2, withWallet: 1 },
    articles: { total: 2, published: 1, drafts: 1 },
    highlights: { total: 1, public: 1 },
    tips: {
      article: {
        total: 3,
        verified: 1,
        byStatus: { CONFIRMED: 2, FAILED: 1 },
      },
      passage: { total: 0, verified: 0 },
      distinctTippers: 1,
      distinctVerifiedTippers: 1,
    },
    waitlist: { total: 1, byStatus: { invited: 1 } },
  })

  const all = await t.action(internal.betaMetrics.getUsageMetrics, {
    excludeTestAccounts: false,
  })
  expect(all).toMatchObject({
    users: { total: 3, withWallet: 2 },
    articles: { total: 3 },
    tips: { article: { total: 4, verified: 2 }, distinctTippers: 2 },
  })
})

test('only waitlist join and feedback submit are callable from clients', async () => {
  const modules = {
    waitlist: await import('../../convex/waitlist'),
    feedback: await import('../../convex/feedback'),
    betaMetrics: await import('../../convex/betaMetrics'),
    testAccounts: await import('../../convex/testAccounts'),
  }
  const exposure: Record<string, 'public' | 'internal'> = {}
  for (const [file, exports] of Object.entries(modules)) {
    for (const [name, value] of Object.entries(exports)) {
      const fn = value as { isPublic?: boolean; isInternal?: boolean }
      if (fn?.isPublic) exposure[`${file}:${name}`] = 'public'
      else if (fn?.isInternal) exposure[`${file}:${name}`] = 'internal'
    }
  }
  expect(exposure).toEqual({
    'waitlist:join': 'public',
    'waitlist:list': 'internal',
    'waitlist:invite': 'internal',
    'feedback:submit': 'public',
    'feedback:listRecent': 'internal',
    'feedback:markReviewed': 'internal',
    'betaMetrics:countPage': 'internal',
    'betaMetrics:getUsageMetrics': 'internal',
    'testAccounts:setTestAccount': 'internal',
    'testAccounts:listTestAccounts': 'internal',
    'testAccounts:backfillInternalAccountsByDomain': 'internal',
  })
})

test('a full waitlist window answers the same for listed and new emails', async () => {
  const t = newTest()
  await t.mutation(api.waitlist.join, {
    ...human,
    email: 'listed@example.test',
  })
  for (let i = 1; i < 30; i++) {
    await t.mutation(api.waitlist.join, {
      ...human,
      email: `flood${i}@example.test`,
    })
  }
  const listed = await errorData(
    t.mutation(api.waitlist.join, { ...human, email: 'listed@example.test' })
  )
  const unlisted = await errorData(
    t.mutation(api.waitlist.join, { ...human, email: 'new@example.test' })
  )
  expect(listed).toBe(unlisted)
  expect(await waitlistRows(t)).toHaveLength(30)
})

test('waitlist caps oversized input and never returns stored data', async () => {
  const t = newTest()
  expect(
    await errorData(
      t.mutation(api.waitlist.join, {
        ...human,
        email: `${'a'.repeat(100_000)}@example.test`,
      })
    )
  ).toBe('Enter a valid email address.')
  const result = await t.mutation(api.waitlist.join, {
    ...human,
    email: 'long@example.test',
    name: 'n'.repeat(100_000),
    interest: 'i'.repeat(100_000),
    source: 's'.repeat(100_000),
  })
  expect(result).toEqual({ ok: true })
  const [row] = await waitlistRows(t)
  expect(row?.name).toHaveLength(80)
  expect(row?.interest).toHaveLength(280)
  expect(row?.source).toHaveLength(40)
})

test('waitlist marks an email that already has an account as joined', async () => {
  const t = newTest()
  const userId = await seedUser(t, { email: 'member@example.test' })
  expect(
    await t.mutation(api.waitlist.join, {
      ...human,
      email: 'Member@Example.test',
    })
  ).toEqual({ ok: true })
  expect((await waitlistRows(t))[0]).toMatchObject({
    status: 'joined',
    userId,
  })
})

test('feedback rejects oversized messages and long paths from signed-in people', async () => {
  const t = newTest()
  const userId = await seedUser(t, { email: 'big@example.test' })
  const reader = t.withIdentity({ subject: `${userId}|session` })
  expect(
    await errorData(
      reader.mutation(api.feedback.submit, {
        category: 'bug',
        message: 'x'.repeat(500_000),
      })
    )
  ).toMatch(/under 2,000 characters/)
  await reader.mutation(api.feedback.submit, {
    category: 'bug',
    message: 'A message with a long path attached.',
    pagePath: `/${'p'.repeat(10_000)}`,
  })
  await reader.mutation(api.feedback.submit, {
    category: 'bug',
    message: 'A message with an external address attached.',
    pagePath: 'https://elsewhere.example/page',
  })
  const rows = await t.run((ctx) => ctx.db.query('feedback').collect())
  expect(rows[0]?.pagePath).toHaveLength(200)
  expect(rows[1]?.pagePath).toBeUndefined()
})

test('usage metrics read every page of large tables', async () => {
  const t = newTest()
  const qa = await seedUser(t, {
    email: 'qa-bulk@example.test',
    isTestAccount: true,
  })
  await t.run(async (ctx) => {
    for (let i = 0; i < 250; i++) {
      await ctx.db.insert('users', {
        email: `bulk${i}@example.test`,
        username: `bulk${i}`,
        createdAt: 1,
        updatedAt: 1,
      })
      await ctx.db.insert('waitlist', {
        email: `wait${i}@example.test`,
        status: i % 2 ? 'pending' : undefined,
        createdAt: 1,
      })
    }
    await ctx.db.insert('feedback', {
      userId: qa,
      category: 'bug',
      message: 'From a test account.',
      status: 'new',
      createdAt: 1,
    })
  })
  const metrics = await t.action(internal.betaMetrics.getUsageMetrics, {})
  expect(metrics).toMatchObject({
    testAccountsExcluded: 1,
    users: { total: 250 },
    waitlist: { total: 250, byStatus: { pending: 250 } },
    feedback: { total: 0 },
  })
  const all = await t.action(internal.betaMetrics.getUsageMetrics, {
    excludeTestAccounts: false,
  })
  expect(all).toMatchObject({
    testAccountsExcluded: 0,
    users: { total: 251 },
    feedback: { total: 1 },
  })
})

// Internal (staff) account classification by email domain.

async function createAccount(t: ReturnType<typeof newTest>, email: string) {
  return t.run(async (ctx) => {
    const userId = await ctx.db.insert('users', {
      email,
      username: email.split('@')[0]!.toLowerCase(),
      createdAt: 1,
      updatedAt: 1,
    })
    await afterAccountCreatedOrUpdated(ctx, {
      userId,
      existingUserId: null,
      email,
    })
    return userId
  })
}

async function flagOf(t: ReturnType<typeof newTest>, userId: unknown) {
  return t.run(async (ctx) => {
    const user = await ctx.db.get(userId as never)
    // Results cross a serialization boundary, so an unset flag is a string.
    return (
      (user as { isTestAccount?: boolean } | null)?.isTestAccount ?? 'unset'
    )
  })
}

test('sign-up flags nothing when no internal domains are configured', async () => {
  vi.stubEnv('INTERNAL_ACCOUNT_EMAIL_DOMAINS', '')
  try {
    const t = newTest()
    const userId = await createAccount(t, 'staff@example.test')
    expect(await flagOf(t, userId)).toBe('unset')
  } finally {
    vi.unstubAllEnvs()
  }
})

test('sign-up flags an account whose email domain is configured', async () => {
  vi.stubEnv(
    'INTERNAL_ACCOUNT_EMAIL_DOMAINS',
    ' Example.TEST , @staff.example.org,,'
  )
  try {
    const t = newTest()
    await t.mutation(api.waitlist.join, {
      ...human,
      email: 'staff@example.test',
    })
    const staff = await createAccount(t, 'Staff@EXAMPLE.test')
    const other = await createAccount(t, 'ops@staff.example.org')
    const reader = await createAccount(t, 'reader@reader.example')
    expect(await flagOf(t, staff)).toBe(true)
    expect(await flagOf(t, other)).toBe(true)
    expect(await flagOf(t, reader)).toBe('unset')
    // The waitlist step still runs for a classified account.
    expect((await waitlistRows(t))[0]).toMatchObject({ status: 'joined' })
  } finally {
    vi.unstubAllEnvs()
  }
})

test('internal domains match exactly, ignoring case only', () => {
  const domains = internalAccountDomains(
    'example.test, Upper.Example , bad domain, *.wild.test, @at.example'
  )
  expect([...domains].sort()).toEqual([
    'at.example',
    'example.test',
    'upper.example',
  ])
  expect(isInternalAccountEmail('a@example.test', domains)).toBe(true)
  expect(isInternalAccountEmail('A@EXAMPLE.TEST', domains)).toBe(true)
  expect(isInternalAccountEmail(' a@upper.example ', domains)).toBe(true)
  // No subdomain, parent-domain, suffix or prefix matches.
  expect(isInternalAccountEmail('a@team.example.test', domains)).toBe(false)
  expect(isInternalAccountEmail('a@example.test.evil.io', domains)).toBe(false)
  expect(isInternalAccountEmail('a@notexample.test', domains)).toBe(false)
  expect(isInternalAccountEmail('a@wild.test', domains)).toBe(false)
  expect(isInternalAccountEmail('a@x.wild.test', domains)).toBe(false)
  // The local part never counts, and malformed emails never match.
  expect(isInternalAccountEmail('example.test@reader.example', domains)).toBe(
    false
  )
  expect(isInternalAccountEmail('a@b@example.test', domains)).toBe(false)
  expect(isInternalAccountEmail('example.test', domains)).toBe(false)
  expect(isInternalAccountEmail(undefined, domains)).toBe(false)
  expect(internalAccountDomains(undefined).size).toBe(0)
})

test('sign-in and password reset never change the flag', async () => {
  vi.stubEnv('INTERNAL_ACCOUNT_EMAIL_DOMAINS', 'example.test')
  try {
    const t = newTest()
    const userId = await createAccount(t, 'staff@example.test')
    // An operator clears the flag; a later sign-in must not set it again.
    await t.mutation(internal.testAccounts.setTestAccount, {
      userId,
      isTestAccount: false,
    })
    await t.run((ctx) =>
      afterAccountCreatedOrUpdated(ctx, {
        userId,
        existingUserId: userId,
        email: 'staff@example.test',
      })
    )
    expect(await flagOf(t, userId)).toBe(false)

    // The account holder cannot set or clear it either.
    const user = t.withIdentity({ subject: `${userId}|session` })
    await expect(
      user.mutation(api.users.updateProfile, {
        // @ts-expect-error not an accepted argument
        isTestAccount: true,
      })
    ).rejects.toThrow()
    expect(await flagOf(t, userId)).toBe(false)
  } finally {
    vi.unstubAllEnvs()
  }
})

test('domain backfill is a dry run by default and idempotent when applied', async () => {
  const t = newTest()
  const staff = await seedUser(t, { email: 'Staff@Example.test' })
  const flagged = await seedUser(t, {
    email: 'qa@example.test',
    isTestAccount: true,
  })
  const sub = await seedUser(t, { email: 'ops@team.example.test' })
  const reader = await seedUser(t, { email: 'reader@reader.example' })

  const dry = await t.mutation(
    internal.testAccounts.backfillInternalAccountsByDomain,
    { domain: 'EXAMPLE.test' }
  )
  expect(dry).toMatchObject({
    domain: 'example.test',
    applied: false,
    matched: 2,
    flagged: 1,
    alreadyFlagged: 1,
    isDone: true,
  })
  expect(await flagOf(t, staff)).toBe('unset')

  const run = await t.mutation(
    internal.testAccounts.backfillInternalAccountsByDomain,
    { domain: 'example.test', apply: true }
  )
  expect(run).toMatchObject({ applied: true, flagged: 1, alreadyFlagged: 1 })
  const again = await t.mutation(
    internal.testAccounts.backfillInternalAccountsByDomain,
    { domain: 'example.test', apply: true }
  )
  expect(again).toMatchObject({ matched: 2, flagged: 0, alreadyFlagged: 2 })
  expect(await flagOf(t, staff)).toBe(true)
  expect(await flagOf(t, flagged)).toBe(true)
  expect(await flagOf(t, sub)).toBe('unset')
  expect(await flagOf(t, reader)).toBe('unset')

  await expect(
    t.mutation(internal.testAccounts.backfillInternalAccountsByDomain, {
      domain: '*.example.test',
    })
  ).rejects.toThrow()
})

test('domain backfill reads users in pages', async () => {
  const t = newTest()
  await t.run(async (ctx) => {
    for (let i = 0; i < 205; i++) {
      await ctx.db.insert('users', {
        email: `staff${i}@example.test`,
        username: `staff${i}`,
        createdAt: 1,
        updatedAt: 1,
      })
    }
  })
  let cursor: string | null = null
  let flagged = 0
  let pages = 0
  for (;;) {
    const page: { flagged: number; continueCursor: string; isDone: boolean } =
      await t.mutation(internal.testAccounts.backfillInternalAccountsByDomain, {
        domain: 'example.test',
        apply: true,
        cursor,
      })
    flagged += page.flagged
    pages += 1
    if (page.isDone) break
    cursor = page.continueCursor
  }
  expect(flagged).toBe(205)
  expect(pages).toBeGreaterThan(1)
  expect(
    await t.query(internal.testAccounts.listTestAccounts, {})
  ).toHaveLength(205)
})

test('usage metrics exclude accounts flagged by domain at sign-up', async () => {
  vi.stubEnv('INTERNAL_ACCOUNT_EMAIL_DOMAINS', 'example.test')
  try {
    const t = newTest()
    const staff = await createAccount(t, 'staff@example.test')
    await createAccount(t, 'reader@reader.example')
    await t.run((ctx) =>
      ctx.db.insert('articles', {
        slug: 'staff-article',
        title: 'Words',
        content: {},
        published: true,
        authorId: staff,
        authorUsername: 'staff',
        createdAt: 1,
        updatedAt: 1,
      })
    )
    const metrics = await t.action(internal.betaMetrics.getUsageMetrics, {})
    expect(metrics).toMatchObject({
      excludeTestAccounts: true,
      testAccountsExcluded: 1,
      users: { total: 1 },
      articles: { total: 0 },
    })
    const all = await t.action(internal.betaMetrics.getUsageMetrics, {
      excludeTestAccounts: false,
    })
    expect(all).toMatchObject({ users: { total: 2 }, articles: { total: 1 } })
  } finally {
    vi.unstubAllEnvs()
  }
})

test('permanent storage query returns a boolean only', async () => {
  const t = newTest()
  try {
    vi.stubEnv('ARWEAVE_ENABLED', 'false')
    vi.stubEnv('ARWEAVE_WALLET_KEY', '')
    expect(await t.query(api.permanentStorage.isEnabled, {})).toBe(false)
    vi.stubEnv('ARWEAVE_ENABLED', 'true')
    // Enabled without the upload wallet stores nothing.
    expect(await t.query(api.permanentStorage.isEnabled, {})).toBe(false)
    vi.stubEnv('ARWEAVE_WALLET_KEY', '{"kty":"placeholder"}')
    expect(await t.query(api.permanentStorage.isEnabled, {})).toBe(true)
  } finally {
    vi.unstubAllEnvs()
  }
})
