import { firstName } from '@/system/money/tip'

/**
 * What the reading view shows of a published article: plain data the server
 * page passes to the view, and the islands need no backend to read it.
 */
export type ReadArticle = {
  id: string
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
  now: number = Date.now()
): ReadArticle {
  const username = article.author.username
  const name = article.author.name?.trim() || username
  return {
    id: article._id,
    slug: article.slug,
    title: article.title,
    href: `/${username}/${article.slug}`,
    writer: {
      name,
      firstName: firstName(name) || name,
      username,
      href: `/${username}`,
      avatar: article.author.avatar ?? null,
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
    coverImage: article.coverImage || null,
    version: {
      updatedAt: article.updatedAt,
      contentVersion: article.contentVersion,
    },
  }
}

/** The body's ids in the server HTML, which the islands attach to. */
export const READ_BODY_ID = 'read-body'
export const READ_MARGIN_ID = 'read-margin'
