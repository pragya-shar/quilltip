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

/** The first words set in small capitals: about four words, whole. */
const LEAD_IN_CHARS = 28

function splitLeadIn(paragraph: string): [string, string] {
  const words = paragraph.split(' ')
  let lead = ''
  let count = 0
  for (const word of words) {
    if (count > 0 && (lead + ' ' + word).length > LEAD_IN_CHARS) break
    lead = count === 0 ? word : `${lead} ${word}`
    count++
  }
  return [lead, paragraph.slice(lead.length)]
}

/**
 * The opening: an article already underway. Title, byline, its first
 * paragraphs in the reading face (the first words in small capitals, the
 * last lines fading into Read more when the article goes on), Read more as a plain
 * link and the time left. Server HTML; nothing here needs a script, and
 * nothing moves or covers it.
 */
export function TodayOpening({ article }: { article: TodayOpeningArticle }) {
  const writerHref = `/${encodeURIComponent(article.author.username)}`
  const [first = '', ...rest] = article.paragraphs
  const [lead, after] = splitLeadIn(first)
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
      <div
        className="qt-today__text"
        data-continues={article.continues ? '' : undefined}
      >
        <Prose className="qt-today__prose">
          {[first, ...rest].map((text, index) => (
            <p key={index}>
              {index === 0 ? (
                <>
                  <span className="qt-today__lead">{lead}</span>
                  {after}
                </>
              ) : (
                text
              )}
            </p>
          ))}
        </Prose>
      </div>
      <p className="qt-today__onward">
        <Button href={article.href} variant="primary" size="l">
          Read more
        </Button>
        {article.minutesLeft > 0 ? (
          <span className="qt-today__left">{article.minutesLeft} min left</span>
        ) : null}
      </p>
    </article>
  )
}
