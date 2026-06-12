import {
  DEFAULT_BROWSE_SORT,
  DEFAULT_BROWSE_VIEW,
  type BrowseSort,
  type BrowseView,
} from './browseDiscovery'

export const ARTICLES_BROWSE_QUERY_KEYS = [
  'tag',
  'page',
  'search',
  'author',
  'view',
  'sort',
] as const

export type ArticlesBrowseQueryKey = (typeof ARTICLES_BROWSE_QUERY_KEYS)[number]

export function pickArticlesBrowseParams(
  searchParams: URLSearchParams
): URLSearchParams {
  const picked = new URLSearchParams()
  for (const key of ARTICLES_BROWSE_QUERY_KEYS) {
    const value = searchParams.get(key)
    if (value) picked.set(key, value)
  }
  return picked
}

export function buildArticlesBrowseHref(options: {
  tag?: string
  page?: number
  search?: string
  author?: string
  view?: BrowseView | ''
  sort?: BrowseSort | ''
  sourceParams?: URLSearchParams | null
}): string {
  const params = options.sourceParams
    ? pickArticlesBrowseParams(options.sourceParams)
    : new URLSearchParams()

  if (options.tag !== undefined) {
    const trimmed = options.tag.trim()
    if (trimmed) params.set('tag', trimmed)
    else params.delete('tag')
  }

  if (options.search !== undefined) {
    const trimmed = options.search.trim()
    if (trimmed) params.set('search', trimmed)
    else params.delete('search')
  }

  if (options.author !== undefined) {
    const trimmed = options.author.trim()
    if (trimmed) params.set('author', trimmed)
    else params.delete('author')
  }

  if (options.view !== undefined) {
    if (options.view && options.view !== DEFAULT_BROWSE_VIEW) {
      params.set('view', options.view)
    } else {
      params.delete('view')
    }
  }

  if (options.sort !== undefined) {
    if (options.sort && options.sort !== DEFAULT_BROWSE_SORT) {
      params.set('sort', options.sort)
    } else {
      params.delete('sort')
    }
  }

  if (options.page !== undefined) {
    if (options.page <= 1) params.delete('page')
    else params.set('page', String(options.page))
  }

  const qs = params.toString()
  return qs ? `/articles?${qs}` : '/articles'
}
