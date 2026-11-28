import type { Id } from '@/convex/_generated/dataModel'
import { firstName } from '@/system/money/tip'
import {
  deploymentSources,
  safeImageSrc,
  type ReadingSources,
} from '@/lib/tiptap/sanitizeReadingDoc'

/**
 * What the reading view shows of a published article: plain data the server
 * page passes to the view, and the islands need no backend to read it.
 */
export type ReadArticle = {
  /** The article's Convex id (the server read's `_id`). */
  id: Id<'articles'>
  slug: string
  title: string
  /** `/{username}/{slug}`: the canonical article URL. */
  href: string
  writer: {
    name: string
    /** The first word of the name, for "Tip Tomás". */
    firstName: string
    username: string
    href: string
    avatar: string | null
  }
  /** "6 min read". */
  readTime: string | null
  /** "Nov 26" this year, "Nov 26, 2025" before. */
  published: string | null
  publishedIso: string | null
  coverImage: string | null
  /**
   * Whether the article can take a tip at all, read on the server
   * (`articleTippable`): false shows no tip control for anyone; null when
   * not known, and the money layer decides in the browser.
   */
  tippable: boolean | null
  /** The fields that change on an edit, for the live check. */
  version: { updatedAt?: number; contentVersion?: number }
}

export type ReadNextItem = {
  id: string
  title: string
  href: string
  opening: string
}

type PublishedArticle = {
  _id: string
  slug: string
  title: string
  coverImage?: string | null
  publishedAt?: number | null
  readTime?: number | null
  updatedAt?: number
  contentVersion?: number
  author: { name?: string | null; username: string; avatar?: string | null }
}

/** "Nov 26", with the year when it is not `now`'s year. UTC, so the server
 * and every reader see the same day. */
export function publishedLabel(at: number, now: number = Date.now()): string {
  const date = new Date(at)
  const sameYear = date.getUTCFullYear() === new Date(now).getUTCFullYear()
  return new Intl.DateTimeFormat('en', {
    month: 'short',
    day: 'numeric',
    year: sameYear ? undefined : 'numeric',
    timeZone: 'UTC',
  }).format(date)
}

export function toReadArticle(
  article: PublishedArticle,
  now: number = Date.now(),
  sources: ReadingSources = deploymentSources()
): ReadArticle {
  const username = article.author.username
  const name = article.author.name?.trim() || username
  return {
    id: article._id as Id<'articles'>,
    slug: article.slug,
    title: article.title,
    href: `/${username}/${article.slug}`,
    writer: {
      name,
      firstName: firstName(name) || name,
      username,
      href: `/${username}`,
      // Under the image rule: this deployment's storage or the site's own
      // image paths; anything else shows initials.
      avatar: safeImageSrc(article.author.avatar, sources),
    },
    readTime:
      article.readTime && article.readTime > 0
        ? `${Math.round(article.readTime)} min read`
        : null,
    published: article.publishedAt
      ? publishedLabel(article.publishedAt, now)
      : null,
    publishedIso: article.publishedAt
      ? new Date(article.publishedAt).toISOString()
      : null,
    // Under the same rule as body images: this deployment's storage only.
    coverImage: safeImageSrc(article.coverImage, sources),
    tippable: null,
    version: {
      updatedAt: article.updatedAt,
      contentVersion: article.contentVersion,
    },
  }
}

/** The body's ids in the server HTML, which the islands attach to. */
export const READ_BODY_ID = 'read-body'
/** The article's title, the h1. */
export const READ_TITLE_ID = 'read-title'
export const READ_MARGIN_ID = 'read-margin'
