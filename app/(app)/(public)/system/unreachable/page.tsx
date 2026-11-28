import type { Metadata } from 'next'
import { PushedScreen } from '@/shell/PushedScreen'
import { retryHrefFor, withinReadLimit } from '@/shell/public/boundedRead'
import { ReadingUnavailable } from '@/system/components/ReadingUnavailable'

/**
 * Noindex like every sample, except with `?indexable=1`: then the page's own
 * metadata says index, as an article's does, and the unreachable state's
 * own noindex must still reach the first response.
 */
export async function generateMetadata({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}): Promise<Metadata> {
  const { indexable } = await searchParams
  return {
    title: 'Unreachable state sample',
    robots:
      indexable === '1'
        ? { index: true, follow: true }
        : { index: false, follow: false },
  }
}

/**
 * The unreachable-state pattern on a read that never answers: the page gives up after a
 * short limit and answers with the unreachable state, in the first response
 * and with no script. Checked by e2e/reading-no-script.spec.ts.
 */
export default async function UnreachableSamplePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const query = await searchParams
  const silent = new Promise<string>(() => {})
  try {
    await withinReadLimit(silent, 50)
  } catch {
    return (
      <PushedScreen>
        <div className="qt-page" data-width="read">
          <ReadingUnavailable
            what="This article"
            retryHref={retryHrefFor('/system/unreachable', query)}
          />
        </div>
      </PushedScreen>
    )
  }
  return null
}
