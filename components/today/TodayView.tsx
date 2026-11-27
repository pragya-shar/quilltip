import { Button } from '@/system/components/Button'
import { EmptyState } from '@/system/components/EmptyState'
import { TodayIcon } from '@/system/icons'
import { MoreToday } from './MoreToday'
import { OfflineNote } from './OfflineNote'
import { ResumeRows } from './ResumeRows'
import { TodayOpening } from './TodayOpening'
import { TodayUnreachable } from './TodayUnreachable'
import { READING_POSITION_KEY } from './readingPlace'
import { reserveScript } from './rowsMemory'
import type { TodayData } from './types'

const RESERVE_SCRIPT = reserveScript(READING_POSITION_KEY)

/**
 * Today: the opening, in the first response, with the rows for a returning
 * person reserved above it. Every part is server HTML except the rows and
 * the offline note, which attach after it without moving it.
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
          returning, signed-in person will see, so filling them later moves
          nothing. It never runs with scripts off. */}
      <script
        nonce={nonce}
        dangerouslySetInnerHTML={{ __html: RESERVE_SCRIPT }}
      />
      <OfflineNote />
      <header className="qt-today__head">
        <p className="qt-today__wordmark">Quilltip</p>
        <p className="qt-today__intro">
          Writing you can tip, down to the sentence.
        </p>
      </header>
      <ResumeRows />
      {!result ? (
        <TodayUnreachable />
      ) : result.opening ? (
        <TodayOpening article={result.opening} />
      ) : (
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
      )}
      {result && result.more.length > 0 ? (
        <MoreToday items={result.more} />
      ) : null}
      {/* Seam for package F3b: the finite mix of articles and paid lines,
          the Following row and the way into /lines (the "Top lines" row)
          come here, after passage identity and counts exist. Until then
          nothing here leads anywhere. The page stays finite: it ends. */}
      {result?.opening ? (
        <p className="qt-today__end">
          You are up to date. New writing arrives through the day.
        </p>
      ) : null}
    </div>
  )
}
