export function isPlaceholderArticleTitle(title: string): boolean {
  const trimmed = title.trim()
  if (trimmed.length === 0) return true
  if (trimmed.toLowerCase() === 'untitled') return true
  return false
}

export function assertPublishableArticleTitle(title: string): void {
  if (isPlaceholderArticleTitle(title)) {
    throw new Error('Cannot publish: add a title before publishing')
  }
}
