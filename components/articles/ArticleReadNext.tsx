import Link from 'next/link'
import { articleHref } from '@/lib/library/bookmarks'
import { extractPlainTextFromTiptapJson } from '@/lib/tiptap/plainText'
import type { JSONContent } from '@tiptap/core'

type NextArticle = {
  _id: string
  title: string
  slug: string
  content?: JSONContent
  excerpt?: string | null
  author: { username?: string | null } | null
}

export function ArticleReadNext({
  currentArticleId,
  articles,
}: {
  currentArticleId: string
  articles: NextArticle[]
}) {
  const next = articles
    .filter(
      (article) =>
        article._id !== currentArticleId &&
        article.author?.username &&
        article.slug
    )
    .slice(0, 2)
  if (!next.length) return null
  return (
    <nav className="reader-read-next" aria-label="Read next">
      <h2>Read next</h2>
      {next.map((article) => {
        const text = extractPlainTextFromTiptapJson(article.content).trim()
        const opening = (
          text.match(/^[^.!?]+[.!?]/)?.[0] ||
          article.excerpt?.trim() ||
          text
        ).slice(0, 180)
        return (
          <Link
            key={article._id}
            href={articleHref({
              username: article.author!.username!,
              slug: article.slug,
            })}
          >
            <span>
              <strong>{article.title}</strong>
              {opening && (
                <span className="reader-next-opening">“{opening}”</span>
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
