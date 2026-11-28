import { v } from 'convex/values'
import { getAuthUserId } from '@convex-dev/auth/server'
import { query, type QueryCtx } from './_generated/server'
import type { Doc } from './_generated/dataModel'
import { estimateArticleReadingMinutes } from '../lib/reading-time'
import { isArticleListingReady } from './lib/articleListingReady'
import {
  CANDIDATE_PAGE,
  CANDIDATE_PAGES,
  SKIP_READ_LIMIT,
  MORE_LIMIT,
  cleanExclude,
  countWords,
  compareForWindow,
  firstSentence,
  fallbackOpeningOf,
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
  /** The first words not shown, drawn faded under the opening; empty when
   * the article does not continue. */
  peek: v.string(),
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
  /** The fallback opening: Read more goes to the article's top. */
  top?: boolean
}

/**
 * One candidate per writer (their newest eligible article) among the
 * articles published in [from, before), newest first, added to `byWriter`
 * (a writer already there keeps their place). Pages are read until `wanted`
 * writers are found or `pages` pages were read; returns the pages read.
 * Both passes of a call share CANDIDATE_PAGES, so a call reads at most
 * CANDIDATE_PAGE × CANDIDATE_PAGES (200) article documents.
 *
 * A page after the first starts at the last page's oldest time, inclusive,
 * and skips what it already saw, so articles published in the same
 * millisecond are not lost. When a whole page shares one time and brings
 * nothing new, the next page starts just before that time, so the read
 * never stalls (articles of that millisecond beyond the page are passed).
 */
async function candidates(
  ctx: QueryCtx,
  range: { from: number | null; before: number },
  wanted: number,
  byWriter: Map<string, Candidate>,
  pages: number,
  fallback: { newest: Candidate | null }
): Promise<number> {
  const seen = new Set<string>()
  let bound = { time: range.before, inclusive: false }
  let read = 0
  while (read < pages) {
    const { time, inclusive } = bound
    read++
    const docs = await ctx.db
      .query('articles')
      .withIndex('by_published_date', (q) => {
        const lower =
          range.from === null
            ? q.eq('published', true)
            : q.eq('published', true).gte('publishedAt', range.from)
        return inclusive
          ? lower.lte('publishedAt', time)
          : lower.lt('publishedAt', time)
      })
      .order('desc')
      .take(CANDIDATE_PAGE)
    let fresh = 0
    for (const article of docs) {
      if (seen.has(article._id)) continue
      seen.add(article._id)
      fresh++
      if (article.publishedAt === undefined || !article.published) continue
      if (!article.slug.trim() || !isArticleListingReady(article)) continue
      const opening = openingOf(article.content)
      if (!opening) {
        // Not one the rule opens (one paragraph): the newest such article
        // opens Today only when nothing else can.
        const short = fallbackOpeningOf(article.content)
        if (
          short &&
          (!fallback.newest ||
            article.publishedAt > fallback.newest.article.publishedAt!)
        )
          fallback.newest = { article, opening: short }
        continue
      }
      if (byWriter.has(article.authorId)) continue
      byWriter.set(article.authorId, { article, opening })
    }
    if (docs.length < CANDIDATE_PAGE) break
    if (byWriter.size >= wanted) break
    const oldest = docs[docs.length - 1]!.publishedAt
    if (oldest === undefined) break
    bound = { time: oldest, inclusive: fresh > 0 }
  }
  return read
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

    // Enough writers for the opening and the list, plus some skipped ones
    // (at most 20 count toward the read; the rest only reorder).
    const wanted = 1 + MORE_LIMIT + Math.min(skip.size, SKIP_READ_LIMIT)
    // Articles published before this hour began come first, in the hour's
    // order, so the opening holds for the hour once one exists.
    const before = new Map<string, Candidate>()
    const fallback: { newest: Candidate | null } = { newest: null }
    const used = await candidates(
      ctx,
      { from: null, before: window.startsAt },
      wanted,
      before,
      CANDIDATE_PAGES,
      fallback
    )
    const compare = compareForWindow(window.index)
    const ranked = [...before.values()].sort((a, b) =>
      compare(a.article._id, b.article._id)
    )
    // Too few: the hour's own articles, up to `at`, follow, newest first, so
    // Today is never empty while an eligible article is published. In an
    // hour with no older article, the newest opens Today.
    if (before.size < wanted && used < CANDIDATE_PAGES) {
      const today = new Map(before)
      await candidates(
        ctx,
        { from: window.startsAt, before: at + 1 },
        wanted,
        today,
        CANDIDATE_PAGES - used,
        fallback
      )
      for (const [writer, candidate] of today)
        if (!before.has(writer)) ranked.push(candidate)
    }
    // Finished articles move to the back; they open only when nothing else can.
    const ordered = [
      ...ranked.filter(({ article }) => !skip.has(article._id)),
      ...ranked.filter(({ article }) => skip.has(article._id)),
    ]

    let opening: (typeof openingValidator)['type'] | null = null
    const more: (typeof moreValidator)['type'][] = []
    // With any published article, Today opens on one: when no article
    // passes the rule, the newest one it cannot open (one paragraph) opens,
    // and its Read more goes to the article's top.
    const last = fallback.newest ? [{ ...fallback.newest, top: true }] : []
    for (const { article, opening: text, top } of [...ordered, ...last]) {
      if (top && opening) break
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
          readMoreHref:
            text.continues && !top
              ? `${href}#${readAnchor(text.nextParagraph)}`
              : href,
          minutesLeft: text.continues
            ? minutesLeft(text.totalWords - text.shownWords)
            : 0,
          peek: text.peek,
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
