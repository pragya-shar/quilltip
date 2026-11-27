import './read.css'
import Link from 'next/link'
import { Avatar } from '@/system/components/Avatar'
import { Heading } from '@/system/components/Heading'
import { TextLink } from '@/system/components/TextLink'
import { PushedHeader } from '@/shell/PushedHeader'
import { PushedScreen } from '@/shell/PushedScreen'
import { ReaderIsland } from './ReaderIsland'
import { ReadingProgress } from './ReadingProgress'
import {
  READ_BODY_ID,
  READ_MARGIN_ID,
  type ReadArticle,
  type ReadNextItem,
} from './readModel'

type ArticleViewProps = {
  article: ReadArticle
  /** The body as server HTML (`renderReadingHtml`). */
  bodyHtml: string | undefined
  /** The body as plain paragraphs, when the HTML could not render. */
  fallbackParagraphs?: string[]
  readNext: ReadNextItem[]
}

/**
 * The article, as a pushed screen. Everything a reader needs is in this
 * component's server HTML: the title, the byline, the full text, the end
 * and Read next, with plain links. The reading progress, the line choice,
 * the place and the tip bar are islands that attach to text already on the
 * page; none of them hides or delays it (D19).
 */
export function ArticleView({
  article,
  bodyHtml,
  fallbackParagraphs = [],
  readNext,
}: ArticleViewProps) {
  return (
    <PushedScreen>
      <ReadingProgress />
      <div className="qt-page qt-read" data-width="read">
        <PushedHeader fallbackHref="/" backLabel="Back to Today" />
        <article className="qt-read__article" aria-labelledby="read-title">
          <header className="qt-read__head">
            <Heading level={1} variant="display" id="read-title">
              {article.title}
            </Heading>
            <p className="qt-read__byline">
              <Avatar
                name={article.writer.name}
                src={article.writer.avatar}
                size={42}
                decorative
              />
              <span className="qt-read__byline-text">
                <a className="qt-read__writer" href={article.writer.href}>
                  {article.writer.name}
                </a>
                {article.readTime || article.published ? (
                  <span className="qt-read__meta">
                    {article.readTime}
                    {article.readTime && article.published ? (
                      <span aria-hidden="true"> · </span>
                    ) : null}
                    {article.published ? (
                      <time dateTime={article.publishedIso ?? undefined}>
                        {article.published}
                      </time>
                    ) : null}
                  </span>
                ) : null}
              </span>
            </p>
          </header>
          {article.coverImage ? (
            <figure className="qt-read__cover">
              {/* The writer's own image, any host: next/image would need
                  every host listed. Eager: it can be the largest paint. */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={article.coverImage} alt="" fetchPriority="high" />
            </figure>
          ) : null}
          <div className="qt-read__body">
            <div
              id={READ_MARGIN_ID}
              className="qt-read__margin"
              aria-hidden="true"
            />
            {bodyHtml ? (
              <div
                id={READ_BODY_ID}
                className="qt-prose qt-read__prose"
                dangerouslySetInnerHTML={{ __html: bodyHtml }}
              />
            ) : (
              <div id={READ_BODY_ID} className="qt-prose qt-read__prose">
                {fallbackParagraphs.map((text, index) => (
                  <p key={index}>{text}</p>
                ))}
              </div>
            )}
          </div>
          <footer className="qt-read__end">
            <Avatar
              name={article.writer.name}
              src={article.writer.avatar}
              size={56}
              decorative
            />
            <p className="qt-read__end-name">{article.writer.name}</p>
            <TextLink href={article.writer.href} variant="standalone">
              {`Read more from ${article.writer.firstName}`}
            </TextLink>
          </footer>
        </article>
        {readNext.length > 0 ? (
          <section className="qt-read__next" aria-labelledby="read-next">
            <Heading level={2} variant="section" id="read-next">
              Read next
            </Heading>
            <ul className="qt-read__next-list">
              {readNext.map((item) => (
                <li key={item.id} className="qt-read__next-item">
                  <p className="qt-read__next-title">{item.title}</p>
                  {item.opening ? (
                    <p className="qt-read__next-opening">{item.opening}</p>
                  ) : null}
                  <Link
                    className="qt-read__next-link"
                    href={item.href}
                    aria-label={`Read more: ${item.title}`}
                  >
                    Read more
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
        <ReaderIsland article={article} />
      </div>
    </PushedScreen>
  )
}
