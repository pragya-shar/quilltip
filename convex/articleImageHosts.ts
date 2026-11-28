import { v } from 'convex/values'
import { internal } from './_generated/api'
import { internalAction, internalQuery } from './_generated/server'
import { articleImageSources } from './lib/articleImages'
import {
  isAllowedImageSource,
  ownImageSource,
} from '../lib/security/imageSources'

/**
 * Read-only report of where article images come from on this deployment
 * (#615), for the cutover: image and cover addresses counted by host, split
 * into published articles and drafts, with whether each host is allowed
 * (`lib/security/imageSources.ts`). No article text, title, author or id.
 *
 *   npx convex run articleImageHosts:countImageHosts
 *
 * The deployment is the one the CLI is pointed at; the function takes no
 * argument.
 */

const PAGE_SIZE = 10

const counts = v.array(
  v.object({
    host: v.string(),
    allowed: v.boolean(),
    published: v.number(),
    draft: v.number(),
  })
)

/** A host label for an address: its host, or the kind of address it is. */
function hostOf(src: unknown): string {
  if (typeof src !== 'string' || !src.trim()) return '(no address)'
  if (/^data:/i.test(src.trim())) return '(data address)'
  if (/^blob:/i.test(src.trim())) return '(blob address)'
  try {
    const url = new URL(src)
    return url.port ? `${url.hostname}:${url.port}` : url.hostname
  } catch {
    return '(relative or invalid address)'
  }
}

type Tally = Map<string, { allowed: boolean; published: number; draft: number }>

function add(tally: Tally, src: unknown, published: boolean) {
  const host = hostOf(src)
  const row = tally.get(host) ?? {
    allowed: isAllowedImageSource(src, process.env.CONVEX_CLOUD_URL),
    published: 0,
    draft: 0,
  }
  if (published) row.published += 1
  else row.draft += 1
  tally.set(host, row)
}

function rows(tally: Tally) {
  return [...tally.entries()]
    .map(([host, row]) => ({ host, ...row }))
    .sort((a, b) => b.published + b.draft - (a.published + a.draft))
}

/** One page of articles, counted. Called by `countImageHosts`. */
export const imageHostPage = internalQuery({
  args: { cursor: v.union(v.string(), v.null()) },
  returns: v.object({
    images: counts,
    covers: counts,
    published: v.number(),
    draft: v.number(),
    continueCursor: v.string(),
    isDone: v.boolean(),
  }),
  handler: async (ctx, { cursor }) => {
    const page = await ctx.db
      .query('articles')
      .paginate({ cursor, numItems: PAGE_SIZE })
    const images: Tally = new Map()
    const covers: Tally = new Map()
    let published = 0
    let draft = 0
    for (const article of page.page) {
      if (article.published) published += 1
      else draft += 1
      for (const src of articleImageSources(article.content)) {
        add(images, src, article.published)
      }
      if (article.coverImage) add(covers, article.coverImage, article.published)
    }
    return {
      images: rows(images),
      covers: rows(covers),
      published,
      draft,
      continueCursor: page.continueCursor,
      isDone: page.isDone,
    }
  },
})

function merge(
  into: Tally,
  page: { host: string; allowed: boolean; published: number; draft: number }[]
) {
  for (const row of page) {
    const total = into.get(row.host) ?? {
      allowed: row.allowed,
      published: 0,
      draft: 0,
    }
    total.published += row.published
    total.draft += row.draft
    into.set(row.host, total)
  }
}

/** Every article, page by page: counts by host, and this deployment's origin. */
export const countImageHosts = internalAction({
  args: {},
  returns: v.object({
    storageOrigin: v.union(v.string(), v.null()),
    articles: v.object({ published: v.number(), draft: v.number() }),
    images: counts,
    covers: counts,
  }),
  handler: async (ctx) => {
    const images: Tally = new Map()
    const covers: Tally = new Map()
    let published = 0
    let draft = 0
    let cursor: string | null = null
    for (;;) {
      const page: {
        images: {
          host: string
          allowed: boolean
          published: number
          draft: number
        }[]
        covers: {
          host: string
          allowed: boolean
          published: number
          draft: number
        }[]
        published: number
        draft: number
        continueCursor: string
        isDone: boolean
      } = await ctx.runQuery(internal.articleImageHosts.imageHostPage, {
        cursor,
      })
      merge(images, page.images)
      merge(covers, page.covers)
      published += page.published
      draft += page.draft
      if (page.isDone) break
      cursor = page.continueCursor
    }
    const own = ownImageSource(process.env.CONVEX_CLOUD_URL)
    return {
      storageOrigin: own
        ? `${own.protocol}://${own.hostname}${own.port ? `:${own.port}` : ''}`
        : null,
      articles: { published, draft },
      images: rows(images),
      covers: rows(covers),
    }
  },
})
