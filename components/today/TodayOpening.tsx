import Link from 'next/link'
import { Avatar } from '@/system/components/Avatar'
import { Button } from '@/system/components/Button'
import { Heading } from '@/system/components/Heading'
import { Prose } from '@/system/components/Prose'
import type { TodayOpeningArticle } from './types'

const PUBLISHED = new Intl.DateTimeFormat('en', {
  month: 'short',
  day: 'numeric',
  timeZone: 'UTC',
})

/**
 * The opening: an article already underway. Title, byline, its first
 * paragraphs in the reading face, and Read more as a plain link. Server
 * HTML; nothing here needs a script, and nothing moves or covers it.
 */
export function TodayOpening({ article }: { article: TodayOpeningArticle }) {
  const writerHref = `/${encodeURIComponent(article.author.username)}`
  return (
    <article className="qt-today__opening" aria-labelledby="today-title">
      <Heading level={1} variant="display" id="today-title">
        {article.title}
      </Heading>
      <p className="qt-today__byline">
        <Avatar name={article.author.name} size={30} decorative />
        <span className="qt-today__byline-text">
          <Link href={writerHref} className="qt-today__writer">
            {article.author.name}
          </Link>
          <span className="qt-today__meta">
            {article.readMinutes} min
            <span aria-hidden="true"> · </span>
            <span className="qt-visually-hidden">, published </span>
            <time dateTime={new Date(article.publishedAt).toISOString()}>
              {PUBLISHED.format(article.publishedAt)}
            </time>
          </span>
        </span>
      </p>
      <Prose className="qt-today__prose">
        {article.paragraphs.map((text, index) => (
          <p
            key={index}
            data-continues={
              article.continues && index === article.paragraphs.length - 1
                ? ''
                : undefined
            }
          >
            {text}
          </p>
        ))}
      </Prose>
      <p className="qt-today__onward">
        <Button href={article.href} variant="primary" size="l">
          Read more
        </Button>
      </p>
    </article>
  )
}
