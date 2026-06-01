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

export function assertPublishableArticleTitle(title: string): void {
  if (isPublishBlockedArticleTitle(title)) {
    throw new Error('Cannot publish: add a title before publishing')
  }
}
