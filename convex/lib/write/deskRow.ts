/**
 * The desk's summary rows (`deskRows`): one per article, holding only what
 * the desk lists, so a desk page reads small rows and never an article
 * document. `syncDeskRow` is the only writer. Call it in the same mutation
 * as every write that inserts or deletes an article or changes its title,
 * content, published state, publish time, slug or `updatedAt`; it is safe to
 * call any number of times and writes only when a field differs.
 */
import type { Doc, Id } from '../../_generated/dataModel'
import type { MutationCtx } from '../../_generated/server'
import { firstLineOf, wordsOf } from './document'

export type DeskFields = Pick<
  Doc<'deskRows'>,
  | 'authorId'
  | 'published'
  | 'title'
  | 'firstLine'
  | 'words'
  | 'updatedAt'
  | 'publishedAt'
  | 'slug'
>

/** The desk's fields of an article, as the desk shows them. */
export function deskFieldsOf(article: Doc<'articles'>): DeskFields {
  return {
    authorId: article.authorId,
    published: article.published === true,
    title: article.title,
    firstLine: firstLineOf(article.content),
    words: wordsOf(article.content),
    updatedAt: article.updatedAt,
    publishedAt: article.publishedAt ?? null,
    slug: article.slug,
  }
}

function same(row: Doc<'deskRows'>, fields: DeskFields): boolean {
  return (Object.keys(fields) as (keyof DeskFields)[]).every(
    (key) => row[key] === fields[key]
  )
}

/**
 * Brings an article's desk row in step with the article: inserts it, patches
 * the fields that differ, or deletes it when the article is gone. Returns
 * whether it wrote. Reads the article and one indexed row.
 */
export async function syncDeskRow(
  ctx: MutationCtx,
  articleId: Id<'articles'>
): Promise<boolean> {
  const [article, row] = await Promise.all([
    ctx.db.get(articleId),
    ctx.db
      .query('deskRows')
      .withIndex('by_article', (q) => q.eq('articleId', articleId))
      .unique(),
  ])
  if (!article) {
    if (!row) return false
    await ctx.db.delete(row._id)
    return true
  }
  const fields = deskFieldsOf(article)
  if (row) {
    if (same(row, fields)) return false
    await ctx.db.patch(row._id, fields)
    return true
  }
  await ctx.db.insert('deskRows', { articleId, ...fields })
  return true
}
