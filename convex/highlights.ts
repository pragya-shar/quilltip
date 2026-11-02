import { v } from 'convex/values'
import { query, mutation } from './_generated/server'
import { getAuthUserId } from '@convex-dev/auth/server'
import { generateHighlightIdServer } from './lib/highlightHash'
import type { MutationCtx, QueryCtx } from './_generated/server'
import type { Doc, Id } from './_generated/dataModel'
import { enrichWithUser } from './lib/enrich'
import schema from './schema'

const highlightFields = {
  ...schema.tables.highlights.validator.fields,
  _id: v.id('highlights'),
  _creationTime: v.number(),
}
const articleSummary = v.union(
  v.null(),
  v.object({
    id: v.id('articles'),
    title: v.string(),
    slug: v.string(),
    authorUsername: v.string(),
  })
)
const userSummary = v.union(
  v.null(),
  v.object({
    id: v.id('users'),
    name: v.optional(v.string()),
    username: v.string(),
    avatar: v.optional(v.string()),
  })
)
const samePassage = (
  a: Pick<Doc<'highlights'>, 'text' | 'startOffset' | 'endOffset'>,
  b: Pick<Doc<'highlights'>, 'text' | 'startOffset' | 'endOffset'>
) =>
  a.text === b.text &&
  a.startOffset === b.startOffset &&
  a.endOffset === b.endOffset

async function appreciationKey(highlight: Doc<'highlights'>) {
  const bytes = new TextEncoder().encode(
    JSON.stringify([
      highlight.articleId,
      highlight.startOffset,
      highlight.endOffset,
      highlight.text,
    ])
  )
  const digest = await crypto.subtle.digest('SHA-256', bytes as BufferSource)
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, '0')
  ).join('')
}

// Get highlights for an article
export const getArticleHighlights = query({
  args: {
    articleId: v.id('articles'),
    isPublic: v.optional(v.boolean()),
  },
  returns: v.array(v.object({ ...highlightFields, user: userSummary })),
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx)
    const article = await ctx.db.get(args.articleId)
    if (!article || (!article.published && article.authorId !== userId))
      return []
    const publicHighlights = await ctx.db
      .query('highlights')
      .withIndex('by_article_public_removed', (q) =>
        q
          .eq('articleId', args.articleId)
          .eq('isPublic', true)
          .eq('removedAt', undefined)
      )
      .collect()

    const privateHighlights = userId
      ? await ctx.db
          .query('highlights')
          .withIndex('by_article_user_public_removed', (q) =>
            q
              .eq('articleId', args.articleId)
              .eq('userId', userId)
              .eq('isPublic', false)
              .eq('removedAt', undefined)
          )
          .collect()
      : []

    const highlights =
      args.isPublic === true
        ? publicHighlights
        : args.isPublic === false
          ? privateHighlights
          : [...publicHighlights, ...privateHighlights]

    // Enrich with current user data (override denormalized userName/userAvatar
    // so avatar/name changes match the profile without stale snapshots)
    const enrichedHighlights = await Promise.all(
      highlights.map(async (highlight) => {
        const user = await enrichWithUser(ctx, highlight.userId)
        if (!user) {
          return { ...highlight, user: null }
        }
        return {
          ...highlight,
          user,
          userName: user.name ?? highlight.userName,
          userAvatar: user.avatar,
        }
      })
    )

    return enrichedHighlights
  },
})

// Get user's highlights
export const getUserHighlights = query({
  args: {
    userId: v.optional(v.id('users')),
  },
  returns: v.array(v.object({ ...highlightFields, article: articleSummary })),
  handler: async (ctx, args) => {
    const callerId = await getAuthUserId(ctx)
    const targetUserId = args.userId || callerId
    if (!targetUserId) return []

    const highlights =
      callerId === targetUserId
        ? await ctx.db
            .query('highlights')
            .withIndex('by_user_removed', (q) =>
              q.eq('userId', targetUserId).eq('removedAt', undefined)
            )
            .order('desc')
            .collect()
        : await ctx.db
            .query('highlights')
            .withIndex('by_user_public_removed', (q) =>
              q
                .eq('userId', targetUserId)
                .eq('isPublic', true)
                .eq('removedAt', undefined)
            )
            .order('desc')
            .collect()

    // Enrich with article data
    const enrichedHighlights = await Promise.all(
      highlights.map(async (highlight) => {
        const article = await ctx.db.get(highlight.articleId)
        return {
          ...highlight,
          article: article
            ? {
                id: article._id,
                title: article.title,
                slug: article.slug,
                authorUsername: article.authorUsername,
              }
            : null,
        }
      })
    )

    return enrichedHighlights
  },
})

// Get user's highlights with tip statistics
export const getUserHighlightsWithTips = query({
  args: {
    userId: v.optional(v.id('users')),
  },
  returns: v.array(
    v.object({
      ...highlightFields,
      article: articleSummary,
      tipStats: v.object({
        count: v.number(),
        totalUsd: v.number(),
        hasTips: v.boolean(),
      }),
    })
  ),
  handler: async (ctx, args) => {
    const callerId = await getAuthUserId(ctx)
    const targetUserId = args.userId || callerId
    if (!targetUserId) return []

    const highlights =
      callerId === targetUserId
        ? await ctx.db
            .query('highlights')
            .withIndex('by_user_removed', (q) =>
              q.eq('userId', targetUserId).eq('removedAt', undefined)
            )
            .order('desc')
            .collect()
        : await ctx.db
            .query('highlights')
            .withIndex('by_user_public_removed', (q) =>
              q
                .eq('userId', targetUserId)
                .eq('isPublic', true)
                .eq('removedAt', undefined)
            )
            .order('desc')
            .collect()

    // Enrich with article data and tip statistics
    const enrichedHighlights = await Promise.all(
      highlights.map(async (highlight) => {
        const article = await ctx.db.get(highlight.articleId)

        // Get all tips for this highlight (by highlightId hash)
        const tips = await ctx.db
          .query('highlightTips')
          .withIndex('by_highlight', (q) =>
            q.eq('highlightId', highlight.highlightId)
          )
          .filter((q) => q.eq(q.field('status'), 'CONFIRMED'))
          .collect()

        const tipCount = tips.length
        const totalTipsUsd = tips.reduce(
          (sum, tip) => sum + tip.amountCents / 100,
          0
        )

        return {
          ...highlight,
          article: article
            ? {
                id: article._id,
                title: article.title,
                slug: article.slug,
                authorUsername: article.authorUsername,
              }
            : null,
          tipStats: {
            count: tipCount,
            totalUsd: totalTipsUsd,
            hasTips: tipCount > 0,
          },
        }
      })
    )

    return enrichedHighlights
  },
})

// Create highlight
export const createHighlight = mutation({
  args: {
    articleId: v.id('articles'),
    text: v.string(),
    startOffset: v.number(),
    endOffset: v.number(),
    startContainerPath: v.string(),
    endContainerPath: v.string(),
    color: v.optional(v.string()),
    note: v.optional(v.string()),
    isPublic: v.optional(v.boolean()),
  },
  returns: v.id('highlights'),
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx)
    if (!userId) throw new Error('Not authenticated')

    const user = await ctx.db.get(userId)
    if (!user) throw new Error('User not found')

    const article = await ctx.db.get(args.articleId)
    if (!article || (!article.published && article.authorId !== userId))
      throw new Error('Article not found')

    // Validate text length to prevent abuse
    if (
      !args.text.trim() ||
      !Number.isInteger(args.startOffset) ||
      !Number.isInteger(args.endOffset) ||
      args.startOffset < 0 ||
      args.endOffset <= args.startOffset
    )
      throw new Error('Invalid passage selection')
    if (args.text.length > 5000) {
      throw new Error('Highlight text too long (max 5000 characters)')
    }

    // Generate deterministic highlight ID (same algorithm as tips)
    const highlightId = await generateHighlightIdServer(
      article.slug,
      args.text,
      args.startOffset,
      args.endOffset
    )

    const candidates = await ctx.db
      .query('highlights')
      .withIndex('by_article_passage_user', (q) =>
        q
          .eq('articleId', args.articleId)
          .eq('highlightId', highlightId)
          .eq('userId', userId)
      )
      .take(100)
    const matching = candidates.filter((h) => samePassage(h, args))
    const existing =
      matching.find((h) => h.removedAt === undefined) ?? matching[0]
    if (existing) {
      if (existing.removedAt !== undefined)
        await setRemoved(ctx, existing, false)
      return existing._id
    }
    const now = Date.now()

    const recordId = await ctx.db.insert('highlights', {
      articleId: args.articleId,
      articleTitle: article.title,
      articleSlug: article.slug,
      articleAuthor: article.authorUsername,
      userId,
      userName: user.name,
      userAvatar: user.avatar,
      text: args.text,
      startOffset: args.startOffset,
      endOffset: args.endOffset,
      startContainerPath: args.startContainerPath,
      endContainerPath: args.endContainerPath,
      highlightId, // Store the hash for linking with tips
      color: args.color || '#FFEB3B',
      note: args.note,
      isPublic: args.isPublic !== false,
      createdAt: now,
      updatedAt: now,
    })

    // Update article highlight count
    await ctx.db.patch(args.articleId, {
      highlightCount: (article.highlightCount || 0) + 1,
    })

    // Update user highlight count
    await ctx.db.patch(userId, {
      highlightCount: (user.highlightCount || 0) + 1,
    })

    return recordId
  },
})

// Update highlight
export const updateHighlight = mutation({
  args: {
    id: v.id('highlights'),
    note: v.optional(v.string()),
    color: v.optional(v.string()),
    isPublic: v.optional(v.boolean()),
  },
  returns: v.id('highlights'),
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx)
    if (!userId) throw new Error('Not authenticated')

    const highlight = await ctx.db.get(args.id)
    if (!highlight) throw new Error('Highlight not found')
    if (highlight.userId !== userId) throw new Error('Not authorized')

    const updates: {
      updatedAt: number
      note?: string
      color?: string
      isPublic?: boolean
    } = {
      updatedAt: Date.now(),
    }

    if (args.note !== undefined) updates.note = args.note
    if (args.color !== undefined) updates.color = args.color
    if (args.isPublic !== undefined) updates.isPublic = args.isPublic

    await ctx.db.patch(args.id, updates)
    return args.id
  },
})

// Delete highlight
export const deleteHighlight = mutation({
  args: {
    id: v.id('highlights'),
  },
  returns: v.object({ success: v.boolean() }),
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx)
    if (!userId) throw new Error('Not authenticated')

    const highlight = await ctx.db.get(args.id)
    if (!highlight) throw new Error('Highlight not found')
    if (highlight.userId !== userId) throw new Error('Not authorized')

    await setRemoved(ctx, highlight, true)
    return { success: true }
  },
})

// Keep the row (including notes, privacy and color) and never mutate tip records.
async function setRemoved(
  ctx: MutationCtx,
  highlight: Doc<'highlights'>,
  removed: boolean
) {
  if ((highlight.removedAt !== undefined) === removed) return
  const delta = removed ? -1 : 1
  for (const id of [highlight.articleId, highlight.userId]) {
    const row = await ctx.db.get(id)
    if (row)
      await ctx.db.patch(id, {
        highlightCount: Math.max(0, (row.highlightCount ?? 0) + delta),
      })
  }
  await ctx.db.patch(highlight._id, {
    removedAt: removed ? Date.now() : undefined,
    updatedAt: Date.now(),
  })
}

export const restoreHighlight = mutation({
  args: { id: v.id('highlights') },
  returns: v.id('highlights'),
  handler: async (ctx, { id }) => {
    const userId = await getAuthUserId(ctx)
    if (!userId) throw new Error('Not authenticated')
    const highlight = await ctx.db.get(id)
    if (!highlight) throw new Error('Highlight not found')
    if (highlight.userId !== userId) throw new Error('Not authorized')
    await setRemoved(ctx, highlight, false)
    return id
  },
})

async function readablePassage(ctx: QueryCtx, id: Id<'highlights'>) {
  const userId = await getAuthUserId(ctx)
  const highlight = await ctx.db.get(id)
  if (
    !highlight ||
    highlight.removedAt !== undefined ||
    (!highlight.isPublic && highlight.userId !== userId)
  )
    throw new Error('Highlight not found')
  const article = await ctx.db.get(highlight.articleId)
  if (!article || (!article.published && article.authorId !== userId))
    throw new Error('Article not found')
  return { highlight, userId }
}

export const getPassageContext = query({
  args: { id: v.id('highlights') },
  returns: v.union(
    v.null(),
    v.object({
      personalId: v.union(v.id('highlights'), v.null()),
      appreciated: v.boolean(),
      otherReaderCount: v.number(),
      countIsLowerBound: v.boolean(),
    })
  ),
  handler: async (ctx, { id }) => {
    // A live removal can invalidate the panel's source before it unmounts.
    const source = await ctx.db.get(id)
    if (!source || source.removedAt !== undefined) return null
    const { highlight, userId } = await readablePassage(ctx, id)
    const readers = await ctx.db
      .query('highlights')
      .withIndex('by_article_passage_public_removed', (q) =>
        q
          .eq('articleId', highlight.articleId)
          .eq('highlightId', highlight.highlightId)
          .eq('isPublic', true)
          .eq('removedAt', undefined)
      )
      .take(1001)
    const personal = userId
      ? await ctx.db
          .query('highlights')
          .withIndex('by_article_passage_user', (q) =>
            q
              .eq('articleId', highlight.articleId)
              .eq('highlightId', highlight.highlightId)
              .eq('userId', userId)
          )
          .take(100)
      : []
    const passageKey = await appreciationKey(highlight)
    const appreciation = userId
      ? await ctx.db
          .query('passageAppreciations')
          .withIndex('by_article_passage_user', (q) =>
            q
              .eq('articleId', highlight.articleId)
              .eq('highlightId', passageKey)
              .eq('userId', userId)
          )
          .first()
      : null
    return {
      personalId:
        personal.find(
          (h) => h.removedAt === undefined && samePassage(h, highlight)
        )?._id ?? null,
      appreciated: Boolean(appreciation),
      otherReaderCount: new Set(
        readers
          .filter((h) => h.userId !== userId && samePassage(h, highlight))
          .map((h) => h.userId)
      ).size,
      countIsLowerBound: readers.length === 1001,
    }
  },
})

export const setPassageAppreciation = mutation({
  args: { id: v.id('highlights'), appreciated: v.boolean() },
  returns: v.null(),
  handler: async (ctx, { id, appreciated }) => {
    const { highlight, userId } = await readablePassage(ctx, id)
    if (!userId) throw new Error('Not authenticated')
    const passageKey = await appreciationKey(highlight)
    const existing = await ctx.db
      .query('passageAppreciations')
      .withIndex('by_article_passage_user', (q) =>
        q
          .eq('articleId', highlight.articleId)
          .eq('highlightId', passageKey)
          .eq('userId', userId)
      )
      .first()
    if (appreciated && !existing)
      await ctx.db.insert('passageAppreciations', {
        articleId: highlight.articleId,
        highlightId: passageKey,
        userId,
      })
    if (!appreciated && existing) await ctx.db.delete(existing._id)
    return null
  },
})
