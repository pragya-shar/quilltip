/// <reference types="vite/client" />
import { convexTest } from 'convex-test'
import { ConvexError } from 'convex/values'
import { expect, test, vi } from 'vitest'
import schema from '../../convex/schema'
import { api, internal } from '../../convex/_generated/api'
import { markWaitlistJoined } from '../../convex/waitlist'

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

test('test-account flag is internal-only and labels public profiles', async () => {
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

  expect(
    (await t.query(api.users.getUserByUsername, { username: 'qa' }))
      ?.isTestAccount
  ).toBe(false)
  await t.mutation(internal.testAccounts.setTestAccount, {
    email: 'QA@example.test',
    isTestAccount: true,
  })
  expect(
    (await t.query(api.users.getUserByUsername, { username: 'qa' }))
      ?.isTestAccount
  ).toBe(true)
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

  const metrics = await t.query(internal.betaMetrics.getUsageMetrics, {})
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

  const all = await t.query(internal.betaMetrics.getUsageMetrics, {
    excludeTestAccounts: false,
  })
  expect(all).toMatchObject({
    users: { total: 3, withWallet: 2 },
    articles: { total: 3 },
    tips: { article: { total: 4, verified: 2 }, distinctTippers: 2 },
  })
})
