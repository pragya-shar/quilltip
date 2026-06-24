import { formatDistanceToNow } from 'date-fns'

export const LISTING_FEED_TAG_LIMIT = 2
export const LISTING_CARD_TAG_LIMIT = 3

export function getTitleMonogram(title: string): string {
  const trimmed = title.trim()
  if (!trimmed) return 'QT'
  return trimmed.slice(0, 2)
}

export function formatListingPublishedDate(
  publishedAt: Date | string | null
): string | null {
  if (!publishedAt) return null
  const date = publishedAt instanceof Date ? publishedAt : new Date(publishedAt)
  if (Number.isNaN(date.getTime())) return null
  return formatDistanceToNow(date, { addSuffix: true })
}

export function formatListingReadTime(minutes?: number): string | null {
  if (!minutes || minutes < 1) return null
  return `${minutes} min read`
}

export function formatListingTipCount(tipCount?: number): string | null {
  const count = tipCount ?? 0
  if (count < 1) return null
  return `${count} tip${count === 1 ? '' : 's'}`
}

export function buildListingMetaParts({
  readTime,
  publishedAt,
  tipCount,
}: {
  readTime?: number
  publishedAt: Date | string | null
  tipCount?: number
}): string[] {
  return [
    formatListingReadTime(readTime),
    formatListingPublishedDate(publishedAt),
    formatListingTipCount(tipCount),
  ].filter((part): part is string => Boolean(part))
}

export function getListingPublishedDateTime(
  publishedAt: Date | string | null
): string | undefined {
  if (!publishedAt) return undefined
  if (publishedAt instanceof Date) return publishedAt.toISOString()
  const date = new Date(publishedAt)
  if (Number.isNaN(date.getTime())) return undefined
  return date.toISOString()
}
