/// <reference types="vite/client" />
import { Keypair } from '@stellar/stellar-sdk'
import { convexTest } from 'convex-test'
import { expect, test, vi } from 'vitest'
import schema from '../../convex/schema'
import { api } from '../../convex/_generated/api'

const modules = import.meta.glob('../../convex/**/*.ts')

test('article and passage presets quote exact XLM while legacy USD tips still use the rate', async () => {
  vi.stubEnv('TIPPING_CONTRACT_ID', 'test-contract')
  vi.stubEnv('STELLAR_NETWORK', 'TESTNET')
  try {
    const t = convexTest(schema, modules)
    const { articleId, readerId, rateId } = await t.run(async ({ db }) => {
      const now = Date.now()
      const authorId = await db.insert('users', {
        username: 'writer',
        email: 'writer@example.test',
        stellarAddress: Keypair.random().publicKey(),
        createdAt: now,
        updatedAt: now,
      })
      const readerId = await db.insert('users', {
        username: 'reader',
        email: 'reader@example.test',
        createdAt: now,
        updatedAt: now,
      })
      const articleId = await db.insert('articles', {
        slug: 'words',
        title: 'Words',
        content: {
          type: 'doc',
          content: [
            {
              type: 'paragraph',
              content: [{ type: 'text', text: 'The words we keep' }],
            },
          ],
        },
        published: true,
        authorId,
        authorUsername: 'writer',
        createdAt: now,
        updatedAt: now,
      })
      const rateId = await db.insert('xlmPriceCache', {
        priceUsd: 0.25,
        source: 'Fixture',
        fetchedAt: now,
      })
      return { articleId, readerId, rateId }
    })
    const user = t.withIdentity({ subject: `${readerId}|session` })
    const base = {
      articleId,
      stellarSourceAccount: Keypair.random().publicKey(),
    }
    const passage = {
      ...base,
      highlightText: 'The words we keep',
      startOffset: 0,
      endOffset: 17,
    }
    const quote = await user.mutation(api.tips.prepareArticleTip, {
      ...base,
      amountXlm: 2,
    })
    expect(quote).toMatchObject({
      amountStroops: 20_000_000,
      amountCents: 50,
      stellarNetwork: 'TESTNET',
    })
    await t.run(({ db }) => db.patch(rateId, { priceUsd: 0.4 }))
    expect(
      await user.mutation(api.tips.prepareArticleTip, { ...base, amountXlm: 2 })
    ).toEqual(quote)
    expect(
      await user.mutation(api.highlightTips.prepareHighlightTip, {
        ...passage,
        amountXlm: 2,
      })
    ).toMatchObject({
      amountStroops: 20_000_000,
      amountCents: 80,
    })
    expect(
      await user.mutation(api.tips.prepareArticleTip, {
        ...base,
        amountCents: 50,
      })
    ).toMatchObject({
      amountStroops: 12_500_000,
      amountCents: 50,
    })
    await expect(
      user.mutation(api.highlightTips.prepareHighlightTip, {
        ...passage,
        amountXlm: 2,
        amountCents: 50,
      })
    ).rejects.toThrow('Invalid tip amount')
  } finally {
    vi.unstubAllEnvs()
  }
})
