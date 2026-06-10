import { useQuery } from 'convex/react'
import { api } from '@/convex/_generated/api'
import type { Id } from '@/types/convex'

import type { BrowseSort, BrowseView } from '@/lib/articles/browseDiscovery'

export type ListArticlesArgs = {
  page?: number
  limit?: number
  tag?: string
  author?: string
  search?: string
  view?: BrowseView
  sort?: BrowseSort
}

export function useListArticles(args: ListArticlesArgs | 'skip') {
  return useQuery(api.articles.listArticles, args === 'skip' ? 'skip' : args)
}

export function useBrowseTags(limit = 12) {
  return useQuery(api.articles.listBrowseTags, { limit })
}

export function useArticleBySlug(
  username: string | null | undefined,
  slug: string | null | undefined
) {
  return useQuery(
    api.articles.getArticleBySlug,
    username && slug ? { username, slug } : 'skip'
  )
}

export function useArticleById(articleId: Id<'articles'> | undefined) {
  return useQuery(
    api.articles.getArticleById,
    articleId ? { id: articleId } : 'skip'
  )
}

export function useUserDrafts() {
  return useQuery(api.articles.getUserDrafts)
}
