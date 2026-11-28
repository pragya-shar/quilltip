import { Heading } from './Heading'
import { READING_UNAVAILABLE_COPY as COPY } from './readingUnavailableCopy'

type ReadingUnavailableProps = {
  /** What could not load: "This article", "This writer’s page", "Today". */
  what: string
  /** The page's own URL (`retryHrefFor`), loaded again by Try again. */
  retryHref: string
  /** 1 when it is the page's only heading. */
  headingLevel?: 1 | 2
}

/**
 * A public page whose bounded server read failed or ran out of time.
 * It reads with no script: a plain message and a plain link that loads the
 * page again. The page still answers 200, so it asks search engines not to
 * index it; the route sends `Cache-Control: no-store` (dynamic pages already
 * do), so nothing keeps it. For every public surface: the article, Today, a
 * writer's page. Pair it with `withinReadLimit` from @/shell/public/boundedRead.
 */
export function ReadingUnavailable({
  what,
  retryHref,
  headingLevel = 1,
}: ReadingUnavailableProps) {
  return (
    <section className="qt-unavailable" aria-labelledby="unavailable-title">
      {/* React places this in the document head. */}
      <meta name="robots" content="noindex" />
      <Heading level={headingLevel} variant="title" id="unavailable-title">
        {COPY.title(what)}
      </Heading>
      <p className="qt-unavailable__body">{COPY.body}</p>
      {/* A plain link: it loads the page again with no script. */}
      <a className="qt-unavailable__retry" href={retryHref}>
        {COPY.retry}
      </a>
    </section>
  )
}
