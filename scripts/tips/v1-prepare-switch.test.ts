/// <reference types="vite/client" />
import { Keypair } from '@stellar/stellar-sdk'
import { convexTest } from 'convex-test'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import schema from '../../convex/schema'
import { api, internal } from '../../convex/_generated/api'
import {
  V1_PREPARES_PAUSED_MESSAGE,
  v1PreparesEnabled,
} from '../../convex/lib/v1Prepares'

const modules = import.meta.glob('../../convex/**/*.ts')
const PASSPHRASE = 'Test SDF Network ; September 2015'
const TX_HASH = 'a'.repeat(64)
const PASSAGE = 'The words we keep'

type T = ReturnType<typeof convexTest>

async function seed(t: T) {
  return t.run(async ({ db }) => {
    const now = Date.now()
    const authorId = await db.insert('users', {
      username: 'writer',
      email: 'writer@example.test',
      stellarAddress: Keypair.random().publicKey(),
      stellarAddressVerifiedAt: now,
      stellarAddressVerifiedNetwork: PASSPHRASE,
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
          { type: 'paragraph', content: [{ type: 'text', text: PASSAGE }] },
        ],
      },
      published: true,
      authorId,
      authorUsername: 'writer',
      createdAt: now,
      updatedAt: now,
    })
    const secondReaderId = await db.insert('users', {
      username: 'second',
      email: 'second@example.test',
      createdAt: now,
      updatedAt: now,
    })
    await db.insert('xlmPriceCache', {
      priceUsd: 0.25,
      source: 'Fixture',
      fetchedAt: now,
    })
    const nftId = await db.insert('articleNFTs', {
      articleId,
      tokenId: '1',
      metadataUrl: 'https://arweave.net/fixture',
      mintedBy: authorId,
      currentOwner: authorId,
      tipThreshold: 10,
      totalTipsAtMint: 10,
      mintedAt: now,
      updatedAt: now,
    })
    return { authorId, readerId, secondReaderId, articleId, nftId }
  })
}

function reader(t: T, readerId: string) {
  return t.withIdentity({ subject: `${readerId}|session` })
}

const source = Keypair.random().publicKey()

describe('CHAIN_V1_PREPARES_ENABLED', () => {
  beforeEach(() => {
    vi.stubEnv('TIPPING_CONTRACT_ID', 'test-contract')
    vi.stubEnv('STELLAR_NETWORK', 'TESTNET')
    vi.stubEnv('CHAIN_V2_ENABLED', 'false')
  })
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('reads unset, empty and true as enabled, and anything else as paused', () => {
    expect(v1PreparesEnabled({})).toBe(true)
    expect(v1PreparesEnabled({ CHAIN_V1_PREPARES_ENABLED: '' })).toBe(true)
    expect(v1PreparesEnabled({ CHAIN_V1_PREPARES_ENABLED: 'true' })).toBe(true)
    expect(v1PreparesEnabled({ CHAIN_V1_PREPARES_ENABLED: ' TRUE ' })).toBe(
      true
    )
    for (const value of ['false', 'False', '0', 'no', 'off']) {
      expect(v1PreparesEnabled({ CHAIN_V1_PREPARES_ENABLED: value })).toBe(
        false
      )
    }
  })

  it('keeps today’s behaviour when unset', async () => {
    const t = convexTest(schema, modules)
    const s = await seed(t)
    const user = reader(t, s.readerId)
    await expect(
      user.mutation(api.tips.prepareArticleTip, {
        articleId: s.articleId,
        stellarSourceAccount: source,
        amountXlm: 2,
      })
    ).resolves.toMatchObject({ amountStroops: 20_000_000 })
    await expect(
      user.mutation(api.highlightTips.prepareHighlightTip, {
        articleId: s.articleId,
        stellarSourceAccount: source,
        highlightText: PASSAGE,
        startOffset: 0,
        endOffset: PASSAGE.length,
        amountXlm: 2,
      })
    ).resolves.toMatchObject({ amountStroops: 20_000_000 })
    expect(
      await t.query(api.chain.articles.getArticleTipAvailability, {
        articleId: s.articleId,
      })
    ).toEqual({ status: 'disabled' })
  })

  it('refuses every v1 prepare when false and keeps reads working', async () => {
    vi.stubEnv('CHAIN_V1_PREPARES_ENABLED', 'false')
    const t = convexTest(schema, modules)
    const s = await seed(t)
    const user = reader(t, s.readerId)
    const author = t.withIdentity({ subject: `${s.authorId}|session` })
    const paused = new RegExp(V1_PREPARES_PAUSED_MESSAGE.slice(0, 30))

    await expect(
      user.mutation(api.tips.prepareArticleTip, {
        articleId: s.articleId,
        stellarSourceAccount: source,
        amountXlm: 2,
      })
    ).rejects.toThrow(paused)
    await expect(
      user.mutation(api.highlightTips.prepareHighlightTip, {
        articleId: s.articleId,
        stellarSourceAccount: source,
        highlightText: PASSAGE,
        startOffset: 0,
        endOffset: PASSAGE.length,
        amountXlm: 2,
      })
    ).rejects.toThrow(paused)
    await expect(
      user.mutation(api.highlightTips.create, {
        highlightId: 'h',
        articleId: s.articleId,
        highlightText: PASSAGE,
        startOffset: 0,
        endOffset: PASSAGE.length,
        amountCents: 50,
        stellarTxId: TX_HASH,
        stellarMemo: 'h',
      })
    ).rejects.toThrow(paused)
    await expect(
      author.mutation(api.nfts.mintNFT, {
        articleId: s.articleId,
        metadataUrl: 'https://arweave.net/fixture',
      })
    ).rejects.toThrow(paused)
    await expect(
      author.mutation(api.nfts.transferNFT, {
        nftId: s.nftId,
        toUsername: 'reader',
      })
    ).rejects.toThrow(paused)
    await expect(
      author.action(api.nftMetadataUpload.uploadNftMetadataForMint, {
        articleId: s.articleId,
        xlmPrice: 0.25,
      })
    ).rejects.toThrow(paused)

    const rows = await t.run(async ({ db }) => ({
      intents: (await db.query('articleTipIntents').collect()).length,
      highlightIntents: (await db.query('highlightTipIntents').collect())
        .length,
      highlightTips: (await db.query('highlightTips').collect()).length,
      nfts: (await db.query('articleNFTs').collect()).length,
    }))
    expect(rows).toEqual({
      intents: 0,
      highlightIntents: 0,
      highlightTips: 0,
      nfts: 1,
    })

    expect(
      await t.query(api.chain.articles.getArticleTipAvailability, {
        articleId: s.articleId,
      })
    ).toEqual({ status: 'paused' })
    await expect(
      t.query(api.tips.getArticleTipStats, { articleId: s.articleId })
    ).resolves.toMatchObject({ totalTips: 0 })
    await expect(
      t.query(api.nfts.getNFTByArticle, { articleId: s.articleId })
    ).resolves.toBeTruthy()
  })

  it('treats a mistyped value as paused', async () => {
    vi.stubEnv('CHAIN_V1_PREPARES_ENABLED', 'flase')
    const t = convexTest(schema, modules)
    const s = await seed(t)
    expect(
      await t.query(api.chain.articles.getArticleTipAvailability, {
        articleId: s.articleId,
      })
    ).toEqual({ status: 'paused' })
  })

  it('lets a tip prepared before the switch complete after it', async () => {
    const t = convexTest(schema, modules)
    const s = await seed(t)
    const user = reader(t, s.readerId)
    const article = await user.mutation(api.tips.prepareArticleTip, {
      articleId: s.articleId,
      stellarSourceAccount: source,
      amountXlm: 2,
    })
    // A second reader, because each reader has a short cooldown between tips.
    const second = reader(t, s.secondReaderId)
    const passage = await second.mutation(
      api.highlightTips.prepareHighlightTip,
      {
        articleId: s.articleId,
        stellarSourceAccount: source,
        highlightText: PASSAGE,
        startOffset: 0,
        endOffset: PASSAGE.length,
        amountXlm: 2,
      }
    )

    vi.stubEnv('CHAIN_V1_PREPARES_ENABLED', 'false')

    const tipId = await user.mutation(api.tips.submitArticleTip, {
      intentId: article.intentId,
      stellarTxId: TX_HASH,
    })
    const highlightTipId = await second.mutation(
      api.highlightTips.submitHighlightTip,
      { intentId: passage.intentId, stellarTxId: 'b'.repeat(64) }
    )
    await t.mutation(internal.articleTipVerify.confirmVerifiedArticleTip, {
      tipId,
    })

    const [tip, highlightTip] = await t.run(async ({ db }) =>
      Promise.all([db.get(tipId), db.get(highlightTipId)])
    )
    expect(tip).toMatchObject({ status: 'CONFIRMED' })
    expect(tip?.verifiedAt).toBeGreaterThan(0)
    expect(highlightTip).toMatchObject({ status: 'PENDING' })
    await expect(
      t.query(api.tips.getArticleTipStats, { articleId: s.articleId })
    ).resolves.toMatchObject({ totalTips: 1 })
  })
})
