/// <reference types="vite/client" />
/**
 * An article published by a writer with no confirmed receiving address
 * (`write.publish` does not require one): no tip path accepts it, and no
 * public query presents it as taking tips, until the writer confirms an
 * address and turns tips on (`scripts/chain/article-registration.test.ts`).
 * A writer with a confirmed address is unaffected.
 */
import { convexTest } from 'convex-test'
import { vi, describe, expect, it } from 'vitest'
import schema from '../../convex/schema'
import { api } from '../../convex/_generated/api'
import type { Id } from '../../convex/_generated/dataModel'
import { CORE } from './fixtures'
import {
  EPOCH,
  HIGHLIGHT,
  READER,
  T,
  TOKEN,
  WRITER,
  as,
  errorCode,
  modules,
  prepare,
  seed,
  withTabEnv,
} from './tab-kit'

withTabEnv()

const doc = (text: string) => ({
  type: 'doc',
  content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
})

/** A new writer with no address publishes through `write.publish`. */
async function publishWithoutAddress(t: T) {
  const writerId = await t.run((ctx) =>
    ctx.db.insert('users', {
      username: 'newwriter',
      email: 'newwriter@example.test',
      name: 'New Writer',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    })
  )
  const writer = as(t, writerId)
  const d = await writer.mutation(api.write.saveDraft, {
    title: 'First words',
    content: doc('The first article, before any wallet.'),
  })
  const published = await writer.mutation(api.write.publish, {
    id: d.id,
    baseUpdatedAt: d.updatedAt,
  })
  return { writerId, articleId: d.id as Id<'articles'>, slug: published.slug }
}

/** Core's cached configuration, so direct tips reach the article checks. */
async function coreReady(t: T) {
  vi.stubEnv('CORE_CONTRACT_ID', CORE)
  await t.run(async (ctx) => {
    const fields = {
      network: 'TESTNET' as const,
      chainEpoch: EPOCH,
      coreContractId: CORE,
      tokenContractId: TOKEN,
      minTip: '1',
      feeBps: 250,
      paused: { core: false },
      refreshedAt: Date.now(),
    }
    const row = await ctx.db.query('chainConfig').first()
    if (row) await ctx.db.patch(row._id, fields)
    else await ctx.db.insert('chainConfig', fields)
  })
}

async function refusal(promise: Promise<unknown>): Promise<string> {
  try {
    await promise
  } catch (error) {
    const data = (error as { data?: unknown }).data
    if (data && typeof data === 'object' && 'code' in data)
      return String((data as { code: unknown }).code)
    return error instanceof Error ? error.message : String(error)
  }
  throw new Error('expected a refusal')
}

describe('an article published without a receiving address', () => {
  it('is published, and no tip path accepts it', async () => {
    const t = convexTest(schema, modules)
    const s = await seed(t)
    await coreReady(t)
    const n = await publishWithoutAddress(t)
    expect((await t.run((ctx) => ctx.db.get(n.articleId)))!.published).toBe(
      true
    )
    const reader = as(t, s.readerId)

    // Balance (tab) tips, whole article and passage.
    expect(await errorCode(prepare(t, s, { articleId: n.articleId }))).toBe(
      'TAB_ARTICLE_NOT_REGISTERED'
    )
    expect(
      await errorCode(
        prepare(t, s, { articleId: n.articleId, highlight: HIGHLIGHT })
      )
    ).toBe('TAB_ARTICLE_NOT_REGISTERED')

    // Wallet (direct) tips through Core: single, passage and batch.
    expect(
      await refusal(
        reader.mutation(api.tipsV2.prepareDirectTip, {
          requestId: 'direct-1',
          articleId: n.articleId,
          amountCents: 100,
        })
      )
    ).toBe('ARTICLE_NOT_REGISTERED')
    expect(
      await refusal(
        reader.mutation(api.tipsV2.prepareHighlightTip, {
          requestId: 'direct-2',
          articleId: n.articleId,
          amountCents: 100,
          highlight: HIGHLIGHT,
        })
      )
    ).toBe('ARTICLE_NOT_REGISTERED')
    expect(
      await refusal(
        reader.mutation(api.tipsV2.prepareBatch, {
          requestId: 'direct-3',
          items: [{ articleId: n.articleId, amountCents: 100 }],
        })
      )
    ).toBe('ARTICLE_NOT_REGISTERED')

    // The older wallet tips go only to a confirmed address.
    expect(
      await refusal(
        reader.mutation(api.tips.prepareArticleTip, {
          articleId: n.articleId,
          amountCents: 100,
          stellarSourceAccount: READER,
        })
      )
    ).toBe('Author has not verified a receiving wallet')
    expect(
      await refusal(
        reader.mutation(api.highlightTips.prepareHighlightTip, {
          articleId: n.articleId,
          highlightText: 'The first article',
          startOffset: 0,
          endOffset: 17,
          amountCents: 100,
          stellarSourceAccount: READER,
        })
      )
    ).toBe('Author has not verified a receiving wallet')
  })

  it('no public query presents it as taking tips', async () => {
    vi.stubEnv('CORE_CONTRACT_ID', CORE)
    const t = convexTest(schema, modules)
    const s = await seed(t)
    const n = await publishWithoutAddress(t)
    const reader = as(t, s.readerId)

    expect(
      await reader.query(api.balance.tipContext, { articleId: n.articleId })
    ).toEqual({ tippable: false, reason: 'not-tippable', ownArticle: false })
    expect(
      await t.query(api.balance.tipContext, { articleId: n.articleId })
    ).toMatchObject({ tippable: false, reason: 'not-tippable' })
    expect(
      await t.query(api.chain.articles.getArticleTipAvailability, {
        articleId: n.articleId,
      })
    ).toEqual({ status: 'unregistered' })
    expect(
      await reader.query(api.tips.canTip, { articleId: n.articleId })
    ).toEqual({ allowed: false, waitSec: 0, reason: 'NOT_REGISTERED' })
    expect(
      await reader.query(api.tipsV2.getTipEligibility, {
        articleId: n.articleId,
      })
    ).toMatchObject({
      eligible: false,
      reason: 'ARTICLE_NOT_REGISTERED',
      authorAddress: null,
    })
    // The reading page and the writer page carry no payout address.
    const page = await t.query(api.articles.getArticleBySlug, {
      username: 'newwriter',
      slug: n.slug,
    })
    expect(page).toMatchObject({ author: { stellarAddress: null } })
    expect(
      await t.query(api.users.getUserByUsername, { username: 'newwriter' })
    ).toMatchObject({ stellarAddress: null })
  })

  it("the writer's own money views answer with nothing earned and no address", async () => {
    const t = convexTest(schema, modules)
    await seed(t)
    await coreReady(t)
    const n = await publishWithoutAddress(t)
    const writer = as(t, n.writerId)
    const earnings = await writer.query(api.earnings.mine, {})
    expect(earnings).toMatchObject({
      isWriter: true,
      pendingCount: 0,
      settledCount: 0,
      pendingCents: 0,
      availableCents: 0,
    })
    const activity = await writer.query(api.activity.mine, {
      role: 'writer',
      paginationOpts: { numItems: 10, cursor: null },
    })
    expect(activity.page).toEqual([])
  })

  it('a writer with a confirmed address is unaffected', async () => {
    vi.stubEnv('CORE_CONTRACT_ID', CORE)
    const t = convexTest(schema, modules)
    const s = await seed(t)
    await publishWithoutAddress(t)
    const reader = as(t, s.readerId)
    // The seeded writer's registered article still takes balance tips.
    expect(
      await reader.query(api.balance.tipContext, { articleId: s.articleId })
    ).toEqual({ tippable: true, reason: null, ownArticle: false })
    const p = await prepare(t, s, { articleId: s.articleId })
    expect(p.writer).toBe(WRITER)
  })
})
