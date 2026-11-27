import { Button } from '@/system/components/Button'
import { EmptyState } from '@/system/components/EmptyState'
import { Notice } from '@/system/components/Notice'
import { TodayIcon } from '@/system/icons'
import { MoreToday } from './MoreToday'
import { ResumeRows } from './ResumeRows'
import { TodayOpening } from './TodayOpening'
import { READING_POSITION_KEY } from './readingPlace'
import { reserveScript } from './rowsMemory'
import type { TodayData } from './types'

const RESERVE_SCRIPT = reserveScript(READING_POSITION_KEY)

/**
 * Today: the opening, in the first response, with the rows for a returning
 * person reserved above it. Every part is server HTML except the rows,
 * which attach after it without moving it.
 */
export function TodayView({
  data,
  nonce,
}: {
  data: TodayData
  /** The CSP nonce for the inline reservation script. */
  nonce?: string
}) {
  const result = data.status === 'ready' ? data.result : null
  return (
    <div className="qt-page qt-today" data-width="read">
      {/* Before the rows and the opening are parsed: reserve the rows a
          returning, signed-in person saw last time, so filling them later
          moves nothing. It never runs with scripts off. */}
      <script
        nonce={nonce}
        dangerouslySetInnerHTML={{ __html: RESERVE_SCRIPT }}
      />
      <header className="qt-today__head">
        <p className="qt-today__wordmark">Quilltip</p>
        <p className="qt-today__intro">
          Writing you can tip, down to the sentence.
        </p>
      </header>
      <ResumeRows />
      {result?.opening ? (
        <TodayOpening article={result.opening} />
      ) : result ? (
        <EmptyState
          icon={TodayIcon}
          title="Nothing to read yet."
          body="The first article published here opens Today."
          action={
            <Button href="/write" variant="primary">
              Write the first article
            </Button>
          }
        />
      ) : (
        <Notice
          tone="failure"
          title="Today’s article did not load."
          action={
            <Button href="/" variant="secondary">
              Try again
            </Button>
          }
        >
          Check your connection, then try again.
        </Notice>
      )}
      {result && result.more.length > 0 ? (
        <MoreToday items={result.more} />
      ) : null}
      {/* The finite mix of articles and paid lines, the Following row and
          the way into /lines come here, after the counts and passage
          identity exist (package F3b). The page stays finite: it ends. */}
      {result?.opening ? (
        <p className="qt-today__end">That is today’s reading.</p>
      ) : null}
    </div>
  )
}
