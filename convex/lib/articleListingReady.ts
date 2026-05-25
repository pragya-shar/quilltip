export const MIN_LISTING_EXCERPT_CHARS = 10

export function isPlaceholderListingTitle(title: string): boolean {
  return title.trim().toLowerCase() === 'untitled'
}

export function isArticleListingReady(article: {
  title: string
  excerpt?: string
  authorUsername?: string
}): boolean {
  const title = article.title.trim()
  const excerpt = (article.excerpt ?? '').trim()
  return (
    title.length > 0 &&
    !isPlaceholderListingTitle(title) &&
    excerpt.length >= MIN_LISTING_EXCERPT_CHARS &&
    Boolean(article.authorUsername?.trim())
  )
}

export function getListingReadyPublishError(input: {
  title: string
  excerpt: string
}): string | null {
  const title = input.title.trim()
  if (title.length === 0) {
    return 'Please add a title before publishing'
  }
  if (isPlaceholderListingTitle(title)) {
    return 'Please replace "Untitled" with a real title before publishing'
  }
  const excerpt = input.excerpt.trim()
  if (excerpt.length < MIN_LISTING_EXCERPT_CHARS) {
    return `Please add an excerpt of at least ${MIN_LISTING_EXCERPT_CHARS} characters before publishing`
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
  const excerpt = (article.excerpt ?? '').trim()
  if (excerpt.length < MIN_LISTING_EXCERPT_CHARS) {
    throw new Error(
      `Cannot publish: add an excerpt of at least ${MIN_LISTING_EXCERPT_CHARS} characters`
    )
  }
  if (!article.authorUsername?.trim()) {
    throw new Error('Cannot publish: author username is required')
  }
}
