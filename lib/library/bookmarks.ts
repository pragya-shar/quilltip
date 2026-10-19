export type Bookmark = {
  id: string
  title: string
  author: string
  username: string
  slug: string
  topic: string
  minutes: number
}
const key = (userId: string) => `quilltip.bookmarks.v1:${userId}`
export const BOOKMARK_EVENT = 'quilltip-bookmarks-change'
export function articleHref(article: Pick<Bookmark, 'username' | 'slug'>) {
  return `/${encodeURIComponent(article.username)}/${encodeURIComponent(article.slug)}`
}
function valid(value: unknown): value is Bookmark {
  if (!value || typeof value !== 'object') return false
  const b = value as Bookmark
  return (
    ['id', 'title', 'author', 'username', 'slug', 'topic'].every(
      (k) => typeof b[k as keyof Bookmark] === 'string'
    ) &&
    /^[\w.-]+$/.test(b.username) &&
    b.slug.length > 0 &&
    !/[\/\\?#]/.test(b.slug) &&
    Number.isFinite(b.minutes) &&
    b.minutes >= 0
  )
}
export function readBookmarks(userId: string): Bookmark[] {
  try {
    const rows: unknown = JSON.parse(localStorage.getItem(key(userId)) || '[]')
    return Array.isArray(rows) ? rows.filter(valid) : []
  } catch {
    return []
  }
}
export function toggleBookmark(userId: string, article: Bookmark): Bookmark[] {
  if (!valid(article)) throw new Error('This article cannot be bookmarked.')
  const previous = readBookmarks(userId)
  const next = previous.some((b) => b.id === article.id)
    ? previous.filter((b) => b.id !== article.id)
    : [article, ...previous]
  // Write first: a blocked storage write must never claim a successful save.
  localStorage.setItem(key(userId), JSON.stringify(next))
  window.dispatchEvent(new Event(BOOKMARK_EVENT))
  return next
}
