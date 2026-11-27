import { v } from 'convex/values'
import { query } from './_generated/server'
import type { Doc } from './_generated/dataModel'
import { estimateArticleReadingMinutes } from '../lib/reading-time'
import { isArticleListingReady } from './lib/articleListingReady'
import {
  CANDIDATE_READ_LIMIT,
  MORE_LIMIT,
  cleanExclude,
  compareForWindow,
  firstSentence,
  openingOf,
  windowOf,
} from './lib/todayOpening'

const authorValidator = v.object({ name: v.string(), username: v.string() })

const moreValidator = v.object({
  articleId: v.string(),
  title: v.string(),
  href: v.string(),
  /** The article's first sentence. */
  first: v.string(),
  author: authorValidator,
  readMinutes: v.number(),
})

const openingValidator = v.object({
  articleId: v.string(),
  title: v.string(),
  href: v.string(),
  author: authorValidator,
  publishedAt: v.number(),
  readMinutes: v.number(),
  paragraphs: v.array(v.string()),
  continues: v.boolean(),
})

export const openingResultValidator = v.object({
  window: v.object({
    index: v.number(),
    startsAt: v.number(),
    endsAt: v.number(),
  }),
  opening: v.union(openingValidator, v.null()),
  more: v.array(moreValidator),
})

type Candidate = {
  article: Doc<'articles'>
  opening: NonNullable<ReturnType<typeof openingOf>>
}

/** One candidate per writer (their newest), each with a real body. */
function candidates(recent: Doc<'articles'>[]): Map<string, Candidate> {
  const byWriter = new Map<string, Candidate>()
  for (const article of recent) {
    if (article.publishedAt === undefined || !article.published) continue
    if (byWriter.has(article.authorId)) continue
    if (!article.slug.trim() || !isArticleListingReady(article)) continue
    const opening = openingOf(article.content)
    if (!opening) continue
    byWriter.set(article.authorId, { article, opening })
  }
  return byWriter
}

/**
 * The article that opens Today, and a short list of what to read after it.
 * Public: returns only published articles, public fields, no notes, no
 * money. Deterministic for a given `at` and `exclude`, so the server render
 * and a reader with no script see the same page. The rule is in
 * convex/lib/todayOpening.ts.
 *
 * `at` is the moment (ms) the caller renders for. `exclude` lists article
 * ids the reader finished (from their browser); they are skipped while
 * another candidate exists.
 */
export const opening = query({
  args: {
    at: v.number(),
    exclude: v.optional(v.array(v.string())),
  },
  returns: openingResultValidator,
  handler: async (ctx, args) => {
    const at = Number.isFinite(args.at) ? args.at : 0
    const window = windowOf(at)
    const skip = cleanExclude(args.exclude)

    // One indexed read: the newest articles published before this window
    // began, so the choice holds for the whole window.
    let byWriter = candidates(
      await ctx.db
        .query('articles')
        .withIndex('by_published_date', (q) =>
          q.eq('published', true).lt('publishedAt', window.startsAt)
        )
        .order('desc')
        .take(CANDIDATE_READ_LIMIT)
    )
    // A catalogue whose every article is newer than the window (a new
    // deployment) still opens on writing: read up to `at` instead.
    if (byWriter.size === 0) {
      byWriter = candidates(
        await ctx.db
          .query('articles')
          .withIndex('by_published_date', (q) =>
            q.eq('published', true).lte('publishedAt', at)
          )
          .order('desc')
          .take(CANDIDATE_READ_LIMIT)
      )
    }

    const compare = compareForWindow(window.index)
    const ranked = [...byWriter.values()].sort((a, b) =>
      compare(a.article._id, b.article._id)
    )
    // Finished articles move to the back; they open only when nothing else can.
    const ordered = [
      ...ranked.filter(({ article }) => !skip.has(article._id)),
      ...ranked.filter(({ article }) => skip.has(article._id)),
    ]

    let opening: (typeof openingValidator)['type'] | null = null
    const more: (typeof moreValidator)['type'][] = []
    for (const { article, opening: text } of ordered) {
      if (opening && (more.length === MORE_LIMIT || skip.has(article._id)))
        break
      const writer = await ctx.db.get(article.authorId)
      const username = writer?.username.trim()
      if (!writer || !username) continue
      const author = { name: writer.name?.trim() || username, username }
      const href = `/${encodeURIComponent(username)}/${encodeURIComponent(article.slug)}`
      const readMinutes =
        article.readTime ?? estimateArticleReadingMinutes(article.content)
      if (!opening) {
        opening = {
          articleId: article._id,
          title: article.title.trim(),
          href,
          author,
          publishedAt: article.publishedAt!,
          readMinutes,
          paragraphs: text.paragraphs,
          continues: text.continues,
        }
      } else {
        more.push({
          articleId: article._id,
          title: article.title.trim(),
          href,
          first: firstSentence(text.paragraphs[0]!),
          author,
          readMinutes,
        })
      }
    }

    return { window, opening, more }
  },
})
