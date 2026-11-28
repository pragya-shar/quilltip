/**
 * Shown when a public page's server read failed or ran out of time (#428).
 * It reads without scripts: a plain message and a plain link that loads the
 * page again. With scripts, the page's live query keeps trying and replaces
 * this once the content arrives.
 *
 * The page still answers 200 (a page cannot set its own status once it
 * renders), so the fallback asks search engines not to index it; dynamic
 * pages already send `Cache-Control: no-store`, so no cache keeps it.
 */
export function ReadingUnavailable({
  what,
  retryHref,
  headingLevel = 2,
}: {
  /** What could not load, for example "This article". */
  what: string
  /** The page's own URL, loaded again by "Try again". */
  retryHref: string
  headingLevel?: 1 | 2
}) {
  const Heading = headingLevel === 1 ? 'h1' : 'h2'
  return (
    <section className="reading-unavailable mx-auto max-w-xl px-6 py-16">
      {/* React places this in the document head. */}
      <meta name="robots" content="noindex" />
      <Heading className="text-2xl">
        {what} could not be loaded right now.
      </Heading>
      <p className="mt-4">
        Quilltip did not answer in time. Please try again in a moment.
      </p>
      <p className="mt-6">
        {/* A plain link, so it reloads the page even without scripts. */}
        <a href={retryHref} className="underline underline-offset-4">
          Try again
        </a>
      </p>
    </section>
  )
}

/** The page's path and query, for the fallback's "Try again" link. */
export function retryHrefFor(
  path: string,
  searchParams: Record<string, string | string[] | undefined>
): string {
  const query = new URLSearchParams()
  for (const [key, value] of Object.entries(searchParams))
    for (const item of Array.isArray(value) ? value : [value])
      if (item !== undefined) query.append(key, item)
  const search = query.toString()
  return search ? `${path}?${search}` : path
}
