/** Articles per page on a writer page. */
export const PROFILE_ARTICLES_PER_PAGE = 9

export type ProfileArticleRow = {
  _id: string
  title: string
  slug: string
  topic?: string
  readTime?: number
}

export type ProfileArticlesPage = {
  articles: ProfileArticleRow[]
  total: number
  page: number
  totalPages: number
}

type ListedArticle = {
  _id: string
  title: string
  slug: string
  tags?: string[]
  readTime?: number
}

/**
 * Keeps only what a writer-page row shows. The server sends this in the HTML,
 * so article bodies stay out of the page.
 */
export function toProfileArticlesPage(data: {
  articles: ListedArticle[]
  total: number
  page: number
  totalPages: number
}): ProfileArticlesPage {
  return {
    articles: data.articles.map(({ _id, title, slug, tags, readTime }) => ({
      _id,
      title,
      slug,
      topic: tags?.[0],
      readTime,
    })),
    total: data.total,
    page: data.page,
    totalPages: data.totalPages,
  }
}

/** Page number from `?page=`; anything invalid is page 1. */
export function parseProfilePage(raw: string | string[] | null | undefined) {
  const value = Array.isArray(raw) ? raw[0] : raw
  const n = parseInt(value || '1', 10)
  return Number.isSafeInteger(n) && n >= 1 ? n : 1
}
