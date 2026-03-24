import { useQuery } from 'convex/react'
import { api } from '@/convex/_generated/api'
import type { Id } from '@/types/convex'

export type ListArticlesArgs = {
  page?: number
  limit?: number
  tag?: string
  author?: string
  search?: string
}

export function useListArticles(args: ListArticlesArgs | 'skip') {
  return useQuery(api.articles.listArticles, args === 'skip' ? 'skip' : args)
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
