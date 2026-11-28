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
  READ_TITLE_ID,
  type ReadArticle,
  type ReadNextItem,
} from './readModel'

type ArticleViewProps = {
  article: ReadArticle
  /** The body as server HTML (`renderReadingHtml`). */
  bodyHtml: string
  readNext: ReadNextItem[]
}

/**
 * The article, as a pushed screen. Everything a reader needs is in this
 * component's server HTML: the title, the byline, the full text, the end
 * and Read next, with plain links. The reading progress, the line choice,
 * the place and the tip bar are islands that attach to text already on the
 * page; none of them hides or delays it, so the article reads with no
 * script.
 */
export function ArticleView({ article, bodyHtml, readNext }: ArticleViewProps) {
  return (
    <PushedScreen>
      <ReadingProgress />
      <div className="qt-page qt-read" data-width="read">
        <PushedHeader fallbackHref="/" backLabel="Back to Today" />
        <article className="qt-read__article" aria-labelledby={READ_TITLE_ID}>
          <header className="qt-read__head">
            <Heading level={1} variant="display" id={READ_TITLE_ID}>
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
              {/* The writer's upload, on this deployment's storage. Eager:
                  it can be the largest paint. */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={article.coverImage}
                alt=""
                fetchPriority="high"
                referrerPolicy="no-referrer"
              />
            </figure>
          ) : null}
          <p id="read-keys" className="qt-visually-hidden">
            Use the arrow keys to move between sentences, Enter to choose a
            line, and Escape to let it go.
          </p>
          <div className="qt-read__body">
            <div
              id={READ_MARGIN_ID}
              className="qt-read__margin"
              aria-hidden="true"
            />
            {/* The system's Prose, as a plain element: the body is HTML. */}
            <div
              id={READ_BODY_ID}
              className="qt-prose qt-read__prose"
              data-variant="read"
              data-lead-in=""
              // One keyboard stop: the arrow keys move between sentences
              // and Enter chooses a line (the island adds this).
              // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- the body is the keyboard surface for choosing a line
              tabIndex={0}
              aria-label="Article text"
              aria-describedby="read-keys"
              dangerouslySetInnerHTML={{ __html: bodyHtml }}
            />
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
