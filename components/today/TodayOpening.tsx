import { AppLink } from '@/system/components/AppLink'
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
 * paragraphs in the reading face (the first line in small capitals, the
 * last lines fading into Read more when the article goes on), Read more as
 * a plain link and the time left. Server HTML; nothing here needs a script, and
 * nothing moves or covers it.
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
          <AppLink href={writerHref} className="qt-today__writer">
            {article.author.name}
          </AppLink>
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
      <div
        className="qt-today__text"
        data-continues={article.continues ? '' : undefined}
      >
        <Prose className="qt-today__prose" leadIn>
          {article.paragraphs.map((text, index) => (
            <p key={index}>{text}</p>
          ))}
        </Prose>
      </div>
      <p className="qt-today__onward">
        {/* Continues where the opening stopped (the paragraph anchor). */}
        <Button href={article.readMoreHref} variant="primary" size="l">
          Read more
          {/* Named like the list's links: "Read more: {title}". */}
          <span className="qt-visually-hidden">: {article.title}</span>
        </Button>
        {article.minutesLeft > 0 ? (
          <span className="qt-today__left">{article.minutesLeft} min left</span>
        ) : null}
      </p>
    </article>
  )
}
