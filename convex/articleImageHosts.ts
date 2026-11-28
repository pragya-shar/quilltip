import { v } from 'convex/values'
import { internal } from './_generated/api'
import { internalAction, internalQuery } from './_generated/server'
import { articleEmbedSources, articleImageSources } from './lib/articleImages'
import { youtubeVideoId } from '../lib/articles/youtubeVideo'
import {
  isAllowedImageSource,
  isOwnStorageAddress,
  ownImageSource,
} from '../lib/security/imageSources'

/**
 * Read-only report of where article images come from on this deployment
 * (#615), for the cutover: image and cover addresses counted by host, split
 * into published articles and drafts, and into allowed and refused
 * addresses (`lib/security/imageSources.ts`). Each address is judged on its
 * own, so one host can have both (`img.youtube.com` outside `/vi/`, `http`
 * against `https`). Profile photos are counted per host too, allowed only in
 * this deployment's own storage, as the save and `UserAvatar` decide (#633).
 * A photo on a listed stock host counts as refused: it shows initials. Video embeds are counted by whether the renderers
 * can rebuild their frame from a video id (`rebuilt`) or show no frame
 * (`noFrame`). No address, article text, title, author, name or id.
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
    publishedAllowed: v.number(),
    publishedRefused: v.number(),
    draftAllowed: v.number(),
    draftRefused: v.number(),
  })
)

type Count = {
  publishedAllowed: number
  publishedRefused: number
  draftAllowed: number
  draftRefused: number
}
type Row = Count & { host: string }
type Tally = Map<string, Count>

const embedCounts = v.object({
  publishedRebuilt: v.number(),
  publishedNoFrame: v.number(),
  draftRebuilt: v.number(),
  draftNoFrame: v.number(),
})
type EmbedCount = {
  publishedRebuilt: number
  publishedNoFrame: number
  draftRebuilt: number
  draftNoFrame: number
}

const ZERO: Count = {
  publishedAllowed: 0,
  publishedRefused: 0,
  draftAllowed: 0,
  draftRefused: 0,
}

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

function add(tally: Tally, src: unknown, published: boolean) {
  const host = hostOf(src)
  const row = { ...(tally.get(host) ?? ZERO) }
  const allowed = isAllowedImageSource(src, process.env.CONVEX_CLOUD_URL)
  if (published && allowed) row.publishedAllowed += 1
  else if (published) row.publishedRefused += 1
  else if (allowed) row.draftAllowed += 1
  else row.draftRefused += 1
  tally.set(host, row)
}

const total = (row: Count) =>
  row.publishedAllowed +
  row.publishedRefused +
  row.draftAllowed +
  row.draftRefused

function rows(tally: Tally): Row[] {
  return [...tally.entries()]
    .map(([host, row]) => ({ host, ...row }))
    .sort((a, b) => total(b) - total(a))
}

const avatarCounts = v.array(
  v.object({ host: v.string(), allowed: v.number(), refused: v.number() })
)
type AvatarRow = { host: string; allowed: number; refused: number }

/** One page of users' profile photos, counted. Called by `countImageHosts`. */
export const avatarHostPage = internalQuery({
  args: { cursor: v.union(v.string(), v.null()) },
  returns: v.object({
    avatars: avatarCounts,
    continueCursor: v.string(),
    isDone: v.boolean(),
  }),
  handler: async (ctx, { cursor }) => {
    const page = await ctx.db.query('users').paginate({ cursor, numItems: 100 })
    const tally = new Map<string, { allowed: number; refused: number }>()
    for (const user of page.page) {
      if (!user.avatar?.trim()) continue
      const host = hostOf(user.avatar)
      const row = tally.get(host) ?? { allowed: 0, refused: 0 }
      if (isOwnStorageAddress(user.avatar.trim(), process.env.CONVEX_CLOUD_URL))
        row.allowed += 1
      else row.refused += 1
      tally.set(host, row)
    }
    return {
      avatars: [...tally.entries()].map(([host, row]) => ({ host, ...row })),
      continueCursor: page.continueCursor,
      isDone: page.isDone,
    }
  },
})

/** One page of articles, counted. Called by `countImageHosts`. */
export const imageHostPage = internalQuery({
  args: { cursor: v.union(v.string(), v.null()) },
  returns: v.object({
    images: counts,
    covers: counts,
    embeds: embedCounts,
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
    const embeds: EmbedCount = {
      publishedRebuilt: 0,
      publishedNoFrame: 0,
      draftRebuilt: 0,
      draftNoFrame: 0,
    }
    for (const article of page.page) {
      for (const src of articleEmbedSources(article.content)) {
        const rebuilt = youtubeVideoId(src) !== null
        if (article.published && rebuilt) embeds.publishedRebuilt += 1
        else if (article.published) embeds.publishedNoFrame += 1
        else if (rebuilt) embeds.draftRebuilt += 1
        else embeds.draftNoFrame += 1
      }
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
      embeds,
      published,
      draft,
      continueCursor: page.continueCursor,
      isDone: page.isDone,
    }
  },
})

function merge(into: Tally, page: Row[]) {
  for (const { host, ...row } of page) {
    const sum = into.get(host) ?? ZERO
    into.set(host, {
      publishedAllowed: sum.publishedAllowed + row.publishedAllowed,
      publishedRefused: sum.publishedRefused + row.publishedRefused,
      draftAllowed: sum.draftAllowed + row.draftAllowed,
      draftRefused: sum.draftRefused + row.draftRefused,
    })
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
    embeds: embedCounts,
    avatars: avatarCounts,
  }),
  handler: async (ctx) => {
    const images: Tally = new Map()
    const covers: Tally = new Map()
    let published = 0
    let draft = 0
    const embeds: EmbedCount = {
      publishedRebuilt: 0,
      publishedNoFrame: 0,
      draftRebuilt: 0,
      draftNoFrame: 0,
    }
    let cursor: string | null = null
    for (;;) {
      const page: {
        images: Row[]
        covers: Row[]
        embeds: EmbedCount
        published: number
        draft: number
        continueCursor: string
        isDone: boolean
      } = await ctx.runQuery(internal.articleImageHosts.imageHostPage, {
        cursor,
      })
      merge(images, page.images)
      merge(covers, page.covers)
      for (const key of Object.keys(embeds) as (keyof EmbedCount)[]) {
        embeds[key] += page.embeds[key]
      }
      published += page.published
      draft += page.draft
      if (page.isDone) break
      cursor = page.continueCursor
    }
    const avatars = new Map<string, { allowed: number; refused: number }>()
    cursor = null
    for (;;) {
      const page: {
        avatars: AvatarRow[]
        continueCursor: string
        isDone: boolean
      } = await ctx.runQuery(internal.articleImageHosts.avatarHostPage, {
        cursor,
      })
      for (const { host, allowed, refused } of page.avatars) {
        const sum = avatars.get(host) ?? { allowed: 0, refused: 0 }
        avatars.set(host, {
          allowed: sum.allowed + allowed,
          refused: sum.refused + refused,
        })
      }
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
      embeds,
      avatars: [...avatars.entries()]
        .map(([host, row]) => ({ host, ...row }))
        .sort((a, b) => b.allowed + b.refused - (a.allowed + a.refused)),
    }
  },
})
