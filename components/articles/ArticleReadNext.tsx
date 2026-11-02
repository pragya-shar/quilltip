import Link from 'next/link'
import { articleHref } from '@/lib/library/bookmarks'
type NextArticle = {
  id: string
  title: string
  slug: string
  username: string
  opening: string
}

export function ArticleReadNext({
  currentArticleId,
  articles,
}: {
  currentArticleId: string
  articles: NextArticle[]
}) {
  const next = articles
    .filter((article) => article.id !== currentArticleId)
    .slice(0, 2)
  if (!next.length) return null
  return (
    <nav className="reader-read-next" aria-label="Read next">
      <h2>Read next</h2>
      {next.map((article) => {
        return (
          <Link
            key={article.id}
            href={articleHref({
              username: article.username,
              slug: article.slug,
            })}
          >
            <span>
              <strong>{article.title}</strong>
              {article.opening && (
                <span className="reader-next-opening">“{article.opening}”</span>
              )}
              <span className="reader-next-label">Read more</span>
            </span>
            <span aria-hidden="true">↗</span>
          </Link>
        )
      })}
    </nav>
  )
}
