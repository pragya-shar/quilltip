import { v } from 'convex/values'
import { getAuthUserId } from '@convex-dev/auth/server'
import { query, type QueryCtx } from './_generated/server'
import type { Doc } from './_generated/dataModel'
import { estimateArticleReadingMinutes } from '../lib/reading-time'
import { isArticleListingReady } from './lib/articleListingReady'
import {
  CANDIDATE_PAGE,
  CANDIDATE_PAGES,
  MORE_LIMIT,
  cleanExclude,
  countWords,
  compareForWindow,
  firstSentence,
  minutesLeft,
  openingOf,
  readAnchor,
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
  /** "Read more": the article at the first paragraph not shown, or the
   * article itself when the opening is the whole of it. */
  readMoreHref: v.string(),
  /** Minutes left after the shown paragraphs; 0 when they are the whole article. */
  minutesLeft: v.number(),
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

/**
 * One candidate per writer (their newest eligible article), newest
 * published first, read in bounded pages until `wanted` writers are found
 * or CANDIDATE_PAGES pages were read. `before` bounds `publishedAt`
 * (exclusive for the window, inclusive for the fallback). A page after the
 * first starts at the last page's oldest time, inclusive, and skips what it
 * already saw, so articles published in the same millisecond are not lost.
 */
async function candidates(
  ctx: QueryCtx,
  before: { time: number; inclusive: boolean },
  wanted: number
): Promise<Map<string, Candidate>> {
  const byWriter = new Map<string, Candidate>()
  const seen = new Set<string>()
  let bound = before
  for (let page = 0; page < CANDIDATE_PAGES; page++) {
    const { time, inclusive } = bound
    const docs = await ctx.db
      .query('articles')
      .withIndex('by_published_date', (q) =>
        inclusive
          ? q.eq('published', true).lte('publishedAt', time)
          : q.eq('published', true).lt('publishedAt', time)
      )
      .order('desc')
      .take(CANDIDATE_PAGE)
    let fresh = 0
    for (const article of docs) {
      if (seen.has(article._id)) continue
      seen.add(article._id)
      fresh++
      if (article.publishedAt === undefined || !article.published) continue
      if (byWriter.has(article.authorId)) continue
      if (!article.slug.trim() || !isArticleListingReady(article)) continue
      const opening = openingOf(article.content)
      if (!opening) continue
      byWriter.set(article.authorId, { article, opening })
    }
    if (docs.length < CANDIDATE_PAGE || fresh === 0) break
    if (byWriter.size >= wanted) break
    const oldest = docs[docs.length - 1]!.publishedAt
    if (oldest === undefined) break
    bound = { time: oldest, inclusive: true }
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
 * ids the reader opened or finished (from their browser's cookies); they
 * are skipped while another candidate exists.
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

    // Enough writers for the opening and the list, after the skipped ones.
    const wanted = 1 + MORE_LIMIT + skip.size
    // Articles published before this day began, so the choice holds all day.
    let byWriter = await candidates(
      ctx,
      { time: window.startsAt, inclusive: false },
      wanted
    )
    // A catalogue whose every article is newer than the day (a new
    // deployment) still opens on writing: read up to `at` instead.
    if (byWriter.size === 0) {
      byWriter = await candidates(ctx, { time: at, inclusive: true }, wanted)
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
          readMoreHref: text.continues
            ? `${href}#${readAnchor(text.nextParagraph)}`
            : href,
          minutesLeft: text.continues
            ? minutesLeft(text.totalWords - text.shownWords)
            : 0,
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

/**
 * The signed-in person's latest draft, for Today's "Your draft" row: one
 * indexed read of their own unpublished articles, newest change first.
 * Only the caller's drafts; null when signed out or when there are none.
 */
export const latestDraft = query({
  args: {},
  returns: v.union(
    v.null(),
    v.object({ id: v.id('articles'), title: v.string(), words: v.number() })
  ),
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx)
    if (!userId) return null
    const draft = await ctx.db
      .query('articles')
      .withIndex('by_author_published_updated_at', (q) =>
        q.eq('authorId', userId).eq('published', false)
      )
      .order('desc')
      .first()
    if (!draft) return null
    return {
      id: draft._id,
      title: draft.title.trim(),
      words: countWords(draft.content),
    }
  },
})
