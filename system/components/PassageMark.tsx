import type { ReactNode } from 'react'
import { cx } from '../cx'
import { DoneIcon } from '../icons'
import { Icon } from './Icon'
import { LineOverlay } from './LineOverlay'

/**
 * The states of a line (design N5). Each has a cue that does not rest on
 * colour (marker on paper is 1.1:1):
 * - `others-top`: tipped by other readers, one of the top two lines of the
 *   page: soft fill, and the tip count after the line in marker-ink.
 * - `others`: tipped by others, the rest: faint fill, ambient (the count
 *   shows in the tip bar's row when the line is chosen).
 * - `mine`: tipped by you: full marker, ink on it, and a check after it.
 * - `kept`: kept by you: a marker-ink underline.
 * - `chosen`: the line the tip bar will tip: an ink underline and an ink
 *   tick in the margin.
 * - `holding`: the hold before sending: a band in the bottom of each line
 *   box fills left to right over the hold, in reading order.
 * - `place`: your place: a marker-ink tick in the margin that fades.
 * - `share-line`: the writer's share line in the editor: a dashed underline.
 */
export type PassageState =
  | 'others-top'
  | 'others'
  | 'mine'
  | 'kept'
  | 'chosen'
  | 'holding'
  | 'place'
  | 'share-line'

type PassageMarkProps = {
  children: ReactNode
  state: PassageState
  /** Times readers tipped this line (others-top shows it; both say it). */
  count?: number
  /** A tip just landed (mine): the stroke draws once. */
  fresh?: boolean
  /** Restarts the hold's band (+$1). */
  holdKey?: number | string
  className?: string
}

/**
 * A line in the reading column. Inline text with no handlers: the surface
 * adds selection and choosing around it, so it never hides or delays
 * reading. Fills and underlines render with no script; the margin tick and
 * the hold's band are drawn by a small client part.
 */
export function PassageMark({
  children,
  state,
  count,
  fresh,
  holdKey,
  className,
}: PassageMarkProps) {
  const others = state === 'others-top' || state === 'others'
  const description =
    others && count
      ? `Readers tipped this line ${count} ${count === 1 ? 'time' : 'times'}`
      : state === 'mine'
        ? 'You tipped this line'
        : undefined
  return (
    <>
      <mark
        className={cx('qt-mark', className)}
        data-state={state}
        data-fresh={fresh || undefined}
        aria-description={description}
      >
        {children}
      </mark>
      {state === 'others-top' && count ? (
        <span className="qt-mark__count" aria-hidden="true">
          {count}
        </span>
      ) : null}
      {state === 'mine' ? (
        <span className="qt-mark__check" aria-hidden="true">
          <Icon icon={DoneIcon} size={16} />
        </span>
      ) : null}
      {state === 'chosen' || state === 'place' || state === 'holding' ? (
        <LineOverlay kind={state} restartKey={holdKey} />
      ) : null}
    </>
  )
}
