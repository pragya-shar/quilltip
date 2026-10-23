import type { Id } from '../_generated/dataModel'
import type { MutationCtx } from '../_generated/server'

type ArticleImages = { content: unknown; coverImage?: string }
type ReferenceTarget = { articleId: Id<'articles'> } | { userId: Id<'users'> }

function normalizedUrls(values: Set<string>): Set<string> {
  const urls = new Set<string>()
  for (const value of values) {
    try {
      const url = new URL(value)
      if (url.protocol !== 'http:' && url.protocol !== 'https:') continue
      url.search = ''
      url.hash = ''
      urls.add(url.href)
    } catch {
      // Non-URL image sources cannot refer to a Convex storage object.
    }
  }
  return urls
}

function imageUrls(article: ArticleImages | null): Set<string> {
  const urls = new Set<string>()
  if (!article) return urls
  if (article.coverImage) urls.add(article.coverImage)
  const visit = (node: unknown) => {
    if (!node || typeof node !== 'object') return
    const record = node as Record<string, unknown>
    if (
      (record.type === 'image' || record.type === 'resizableImage') &&
      record.attrs &&
      typeof record.attrs === 'object'
    ) {
      const src = (record.attrs as Record<string, unknown>).src
      if (typeof src === 'string') urls.add(src)
    }
    if (Array.isArray(record.content)) record.content.forEach(visit)
  }
  visit(article.content)
  return urls
}

async function syncReferences(
  ctx: MutationCtx,
  target: ReferenceTarget,
  before: Set<string>,
  after: Set<string>
) {
  const previousUrls = normalizedUrls(before)
  const nextUrls = normalizedUrls(after)
  for (const url of new Set([...previousUrls, ...nextUrls])) {
    const owner = await ctx.db
      .query('uploadOwners')
      .withIndex('by_url', (q) => q.eq('url', url))
      .unique()
    if (!owner?.referencesTracked) continue
    const reference =
      'articleId' in target
        ? await ctx.db
            .query('uploadReferences')
            .withIndex('by_article_storage', (q) =>
              q
                .eq('articleId', target.articleId)
                .eq('storageId', owner.storageId)
            )
            .unique()
        : await ctx.db
            .query('uploadReferences')
            .withIndex('by_user_storage', (q) =>
              q.eq('userId', target.userId).eq('storageId', owner.storageId)
            )
            .unique()
    if (nextUrls.has(url) && !reference) {
      await ctx.db.insert('uploadReferences', {
        storageId: owner.storageId,
        ...target,
      })
    } else if (!nextUrls.has(url) && reference) {
      await ctx.db.delete(reference._id)
    }
  }
}

export async function syncArticleUploadReferences(
  ctx: MutationCtx,
  articleId: Id<'articles'>,
  before: ArticleImages | null,
  after: ArticleImages | null
) {
  await syncReferences(ctx, { articleId }, imageUrls(before), imageUrls(after))
}

export async function syncAvatarUploadReference(
  ctx: MutationCtx,
  userId: Id<'users'>,
  before?: string,
  after?: string
) {
  await syncReferences(
    ctx,
    { userId },
    new Set(before ? [before] : []),
    new Set(after ? [after] : [])
  )
}
