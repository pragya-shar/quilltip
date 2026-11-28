import { ConvexError } from 'convex/values'

const MIN_PUBLISHABLE_TITLE_LENGTH = 3

export function isPlaceholderArticleTitle(title: string): boolean {
  const trimmed = title.trim()
  if (trimmed.length === 0) return true
  if (trimmed.toLowerCase() === 'untitled') return true
  return false
}

export function isPublishBlockedArticleTitle(title: string): boolean {
  const trimmed = title.trim()
  if (isPlaceholderArticleTitle(trimmed)) return true
  if (trimmed.length < MIN_PUBLISHABLE_TITLE_LENGTH) return true
  return false
}

// Refusals for the writer are ConvexErrors: a production deployment redacts a
// plain Error's message, and the page shows a ConvexError's data (#633).
export function assertPublishableArticleTitle(title: string): void {
  if (isPublishBlockedArticleTitle(title)) {
    throw new ConvexError('Cannot publish: add a title before publishing')
  }
}
