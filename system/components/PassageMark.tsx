import type { ReactNode } from 'react'
import { cx } from '../cx'
import { DoneIcon } from '../icons'
import { Icon } from './Icon'
import { LineOverlay } from './LineOverlay'

/**
 * The states of a line. Each has a cue that does not rest on
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

/** States that go together on one line: a chosen line keeps other readers'
 * fill; a line can be kept and tipped by you at once. */
export const COMBINABLE: readonly (readonly PassageState[])[] = [
  ['others-top', 'chosen'],
  ['others', 'chosen'],
  ['mine', 'chosen'],
  ['kept', 'chosen'],
  ['mine', 'kept'],
  ['others-top', 'kept'],
  ['others', 'kept'],
]

type PassageMarkProps = {
  children: ReactNode
  /** One state, or several that go together (`COMBINABLE`):
   * `['others-top', 'chosen']`, `['mine', 'kept']`. */
  state: PassageState | readonly PassageState[]
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
  const states: readonly PassageState[] =
    typeof state === 'string' ? [state] : state
  const has = (s: PassageState) => states.includes(s)
  const others = has('others-top') || has('others')
  const description =
    [
      others && count
        ? `Readers tipped this line ${count} ${count === 1 ? 'time' : 'times'}`
        : has('mine')
          ? 'You tipped this line'
          : null,
      has('kept') ? 'Kept' : null,
    ]
      .filter(Boolean)
      .join('. ') || undefined
  // The one thing drawn outside the text: the hold's band, else a tick.
  const overlay = has('holding')
    ? 'holding'
    : has('chosen')
      ? 'chosen'
      : has('place')
        ? 'place'
        : null
  return (
    <>
      <mark
        className={cx('qt-mark', className)}
        data-state={states.join(' ')}
        data-fresh={fresh || undefined}
        aria-description={description}
      >
        {children}
      </mark>
      {has('others-top') && count ? (
        <span className="qt-mark__count" aria-hidden="true">
          <span>{count}</span>
        </span>
      ) : null}
      {has('mine') ? (
        <span className="qt-mark__check" aria-hidden="true">
          <Icon icon={DoneIcon} size={16} />
        </span>
      ) : null}
      {overlay ? <LineOverlay kind={overlay} restartKey={holdKey} /> : null}
    </>
  )
}
