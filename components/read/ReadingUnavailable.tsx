import './unavailable.css'
import { Heading } from '@/system/components/Heading'

type ReadingUnavailableProps = {
  /** What could not load: "This article", "This writer’s page". */
  what: string
  /** The page's own URL (`retryHrefFor`), loaded again by Try again. */
  retryHref: string
  /** 1 when it is the page's only heading. */
  headingLevel?: 1 | 2
}

/**
 * A public page whose server read failed or ran out of time (D21). It reads
 * with no script: a plain message and a plain link that loads the page
 * again. The page still answers 200, so it asks search engines not to index
 * it; dynamic pages already send `Cache-Control: no-store`, so nothing keeps
 * it. For any public surface: the article, Today, a writer's page.
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
        {`${what} could not be loaded right now.`}
      </Heading>
      <p className="qt-unavailable__body">
        Quilltip did not answer in time. Try again in a moment.
      </p>
      {/* A plain link: it loads the page again with no script. */}
      <a className="qt-unavailable__retry" href={retryHref}>
        Try again
      </a>
    </section>
  )
}
