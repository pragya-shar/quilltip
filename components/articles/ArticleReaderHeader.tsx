import type { ReactNode } from 'react'

export function ArticleReaderHeader({
  title,
  subtitle,
  topic,
  author,
  readingMinutes,
  bookmark,
}: {
  title: string
  subtitle?: string | null
  topic?: string
  author: ReactNode
  readingMinutes: number
  bookmark?: ReactNode
}) {
  return (
    <header className="reader-header">
      {topic && <p className="reader-eyebrow">{topic}</p>}
      <div className="article-title-bookmark">
        <h1 className="reader-title">{title}</h1>
        {bookmark}
      </div>
      {subtitle?.trim() && <p className="reader-subtitle">{subtitle}</p>}
      {author && (
        <p className="reader-byline">
          {author}
          {' · '}
          {readingMinutes} min read
        </p>
      )}
    </header>
  )
}
