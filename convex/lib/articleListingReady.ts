import { getArticlePreview } from './articlePreview'

export function isPlaceholderListingTitle(title: string): boolean {
  return title.trim().toLowerCase() === 'untitled'
}

export function isArticleListingReady(article: {
  title: string
  excerpt?: string
  content?: unknown
  authorUsername?: string
}): boolean {
  const title = article.title.trim()
  return (
    title.length > 0 &&
    !isPlaceholderListingTitle(title) &&
    Boolean(getArticlePreview(article)) &&
    Boolean(article.authorUsername?.trim())
  )
}

export function getListingReadyPublishError(input: {
  title: string
  excerpt?: string
}): string | null {
  const title = input.title.trim()
  if (title.length === 0) {
    return 'Please add a title before publishing'
  }
  if (isPlaceholderListingTitle(title)) {
    return 'Please replace "Untitled" with a real title before publishing'
  }
  return null
}

export function assertArticleListingReady(article: {
  title: string
  excerpt?: string
  authorUsername?: string
}): void {
  const title = article.title.trim()
  if (title.length === 0 || isPlaceholderListingTitle(title)) {
    throw new Error('Cannot publish: add a real title (not "Untitled")')
  }
  if (!article.authorUsername?.trim()) {
    throw new Error('Cannot publish: author username is required')
  }
}
