import type { ListArticleRow } from '@/types/convex'
import type { ArticleForDisplay } from '@/types/index'
import { getArticlePreview } from '@/convex/lib/articlePreview'
import { getArticleOpening } from './getArticleOpening'

export function mapListArticleRowToDisplay(
  article: ListArticleRow,
  options?: { compact?: boolean }
): ArticleForDisplay {
  return {
    id: article._id,
    slug: article.slug,
    title: article.title,
    excerpt:
      (options?.compact
        ? getArticleOpening(article)
        : getArticlePreview(article)) || null,
    coverImage: article.coverImage ?? null,
    publishedAt: article.publishedAt ? new Date(article.publishedAt) : null,
    author: article.author
      ? {
          id: article.author.id as string,
          name: article.author.name ?? null,
          username: article.author.username,
          avatar: article.author.avatar ?? null,
        }
      : {
          id: '',
          name: article.authorName ?? null,
          username: article.authorUsername?.trim() || 'unknown',
          avatar: article.authorAvatar ?? null,
        },
    tags: (article.tags ?? []).map((tagName, index) => ({
      id: `tag-${index}`,
      name: tagName,
      slug: tagName.toLowerCase().replace(/\s+/g, '-'),
    })),
    readTime: article.readTime,
    tipCount: article.tipCount,
    highlightCount: article.highlightCount,
  }
}

export function mapListArticlesToDisplay(
  articles: ListArticleRow[],
  options?: { compact?: boolean }
): ArticleForDisplay[] {
  return articles.map((article) => mapListArticleRowToDisplay(article, options))
}
