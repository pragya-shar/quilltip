/// <reference types="vite/client" />
import { convexTest } from 'convex-test'
import { expect, test } from 'vitest'
import schema from '../../convex/schema'
import { api } from '../../convex/_generated/api'

const modules = import.meta.glob('../../convex/**/*.ts')

async function setup() {
  const t = convexTest(schema, modules)
  const ids = await t.run(async (ctx) => {
    const now = Date.now()
    const owner = await ctx.db.insert('users', {
      email: 'reader@example.test',
      username: 'reader',
      createdAt: now,
      updatedAt: now,
    })
    const other = await ctx.db.insert('users', {
      email: 'other@example.test',
      username: 'other',
      createdAt: now,
      updatedAt: now,
    })
    const article = await ctx.db.insert('articles', {
      slug: 'exact-passage',
      title: 'Words',
      content: {},
      published: true,
      authorId: other,
      authorUsername: 'other',
      createdAt: now,
      updatedAt: now,
    })
    return { owner, other, article }
  })
  const owner = t.withIdentity({ subject: `${ids.owner}|session` })
  const other = t.withIdentity({ subject: `${ids.other}|session` })
  const selection = {
    articleId: ids.article,
    text: 'The words we keep',
    startOffset: 0,
    endOffset: 17,
    startContainerPath: 'text.1',
    endContainerPath: 'text.18',
  }
  return { t, ids, owner, other, selection }
}

test('removing a tipped personal save preserves its ID, metadata and financial records; undo is idempotent', async () => {
  const { t, owner, other, ids, selection } = await setup()
  const id = await owner.mutation(api.highlights.createHighlight, {
    ...selection,
    note: 'A private thought',
    color: '#10B981',
    isPublic: false,
  })
  const before = await t.run((ctx) => ctx.db.get(id))
  const tipId = await t.run((ctx) =>
    ctx.db.insert('highlightTips', {
      highlightId: before!.highlightId,
      articleId: ids.article,
      tipperId: ids.owner,
      authorId: ids.other,
      highlightText: selection.text,
      articleTitle: 'Words',
      articleSlug: 'exact-passage',
      amountUsd: 1,
      amountCents: 100,
      stellarTxId: 'fixture-confirmed-receipt',
      stellarNetwork: 'TESTNET',
      stellarMemo: before!.highlightId,
      startOffset: 0,
      endOffset: 17,
      status: 'CONFIRMED',
      createdAt: 1,
      processedAt: 1,
      updatedAt: 1,
    })
  )
  const receipt = await t.run((ctx) => ctx.db.get(tipId))
  await expect(
    other.mutation(api.highlights.deleteHighlight, { id })
  ).rejects.toThrow('Not authorized')
  await owner.mutation(api.highlights.deleteHighlight, { id })
  await owner.mutation(api.highlights.deleteHighlight, { id })
  expect(await owner.query(api.highlights.getUserHighlights, {})).toEqual([])
  expect(await t.run((ctx) => ctx.db.get(tipId))).toEqual(receipt)
  await owner.mutation(api.highlights.restoreHighlight, { id })
  await owner.mutation(api.highlights.restoreHighlight, { id })
  const saved = await owner.query(api.highlights.getUserHighlights, {})
  expect(saved).toHaveLength(1)
  expect(saved[0]).toMatchObject({
    _id: id,
    note: 'A private thought',
    color: '#10B981',
    isPublic: false,
  })
  expect(await t.run((ctx) => ctx.db.get(ids.owner))).toMatchObject({
    highlightCount: 1,
  })
})

test('public reader counts deduplicate saves, exclude private saves and isolate appreciation by account', async () => {
  const { t, owner, other, selection } = await setup()
  const id = await owner.mutation(api.highlights.createHighlight, selection)
  expect(await owner.mutation(api.highlights.createHighlight, selection)).toBe(
    id
  )
  const otherId = await other.mutation(api.highlights.createHighlight, {
    ...selection,
    isPublic: false,
  })
  expect(
    await owner.query(api.highlights.getPassageContext, { id })
  ).toMatchObject({ otherReaderCount: 0, appreciated: false, personalId: id })
  await other.mutation(api.highlights.updateHighlight, {
    id: otherId,
    isPublic: true,
  })
  expect(
    await owner.query(api.highlights.getPassageContext, { id })
  ).toMatchObject({ otherReaderCount: 1 })
  await owner.mutation(api.highlights.setPassageAppreciation, {
    id,
    appreciated: true,
  })
  await owner.mutation(api.highlights.setPassageAppreciation, {
    id,
    appreciated: true,
  })
  expect(
    await owner.query(api.highlights.getPassageContext, { id })
  ).toMatchObject({ appreciated: true })
  expect(
    await other.query(api.highlights.getPassageContext, { id })
  ).toMatchObject({ appreciated: false, personalId: otherId })
  await owner.mutation(api.highlights.setPassageAppreciation, {
    id,
    appreciated: false,
  })
  expect(
    await owner.query(api.highlights.getPassageContext, { id })
  ).toMatchObject({ appreciated: false })
  await expect(
    t.mutation(api.highlights.setPassageAppreciation, { id, appreciated: true })
  ).rejects.toThrow('Not authenticated')
  await owner.mutation(api.highlights.deleteHighlight, { id })
  expect(
    await other.query(api.highlights.getPassageContext, { id: otherId })
  ).toMatchObject({ otherReaderCount: 0, personalId: otherId })
  await expect(
    other.mutation(api.highlights.restoreHighlight, { id })
  ).rejects.toThrow('Not authorized')
  expect(await owner.mutation(api.highlights.createHighlight, selection)).toBe(
    id
  )
})

test('private highlights and unpublished articles cannot be accessed by another reader', async () => {
  const { t, ids, owner, other, selection } = await setup()
  const id = await owner.mutation(api.highlights.createHighlight, {
    ...selection,
    isPublic: false,
  })
  await expect(
    other.query(api.highlights.getPassageContext, { id })
  ).rejects.toThrow('Highlight not found')
  await expect(
    other.mutation(api.highlights.setPassageAppreciation, {
      id,
      appreciated: true,
    })
  ).rejects.toThrow('Highlight not found')
  await t.run((ctx) => ctx.db.patch(ids.article, { published: false }))
  expect(
    await owner.query(api.highlights.getArticleHighlights, {
      articleId: ids.article,
    })
  ).toEqual([])
  await expect(
    owner.mutation(api.highlights.createHighlight, selection)
  ).rejects.toThrow('Article not found')
})

test('long passages sharing the legacy tip-hash prefix keep independent saves and appreciations', async () => {
  const { owner, other, selection } = await setup()
  const a = {
    ...selection,
    text: 'A'.repeat(50) + ' first ending',
    endOffset: 100,
  }
  const b = { ...a, text: 'A'.repeat(50) + ' other ending' }
  const first = await owner.mutation(api.highlights.createHighlight, a)
  const second = await owner.mutation(api.highlights.createHighlight, b)
  expect(second).not.toBe(first)
  await other.mutation(api.highlights.createHighlight, b)
  await owner.mutation(api.highlights.setPassageAppreciation, {
    id: first,
    appreciated: true,
  })
  expect(
    await owner.query(api.highlights.getPassageContext, { id: first })
  ).toMatchObject({ otherReaderCount: 0, appreciated: true, personalId: first })
  expect(
    await owner.query(api.highlights.getPassageContext, { id: second })
  ).toMatchObject({
    otherReaderCount: 1,
    appreciated: false,
    personalId: second,
  })
})
