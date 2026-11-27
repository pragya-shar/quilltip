import type { Metadata } from 'next'
import { PushedScreen } from '@/shell/PushedScreen'
import { retryHrefFor, withinReadLimit } from '@/shell/public/boundedRead'
import { ReadingUnavailable } from '@/system/components/ReadingUnavailable'

export const metadata: Metadata = {
  title: 'Unreachable state sample',
  robots: { index: false, follow: false },
}

/**
 * The D21 pattern on a read that never answers: the page gives up after a
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
