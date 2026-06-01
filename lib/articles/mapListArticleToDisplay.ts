import type { ListArticleRow } from '@/types/convex'
import type { ArticleForDisplay } from '@/types/index'

export function mapListArticleRowToDisplay(
  article: ListArticleRow
): ArticleForDisplay {
  return {
    id: article._id,
    slug: article.slug,
    title: article.title,
    excerpt: article.excerpt ?? null,
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
  }
}

export function mapListArticlesToDisplay(
  articles: ListArticleRow[]
): ArticleForDisplay[] {
  return articles.map(mapListArticleRowToDisplay)
}
