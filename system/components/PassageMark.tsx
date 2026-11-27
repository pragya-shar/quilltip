import type { ReactNode } from 'react'
import { cx } from '../cx'
import { TipIcon } from '../icons'
import { Icon } from './Icon'

type PassageMarkProps = {
  children: ReactNode
  /** 3: full marker (most tipped on the page), 2: soft, 1: faint. */
  heat?: 1 | 2 | 3
  /** The passage's total and count, from the money layer: "$14 · 23". */
  total?: string
  /** The words a screen reader hears for the total: "$14 from 23 tips". */
  totalLabel?: string
  /** The line the tip control will tip. Adds an underline: not colour alone. */
  targeted?: boolean
  /** A tip just landed here: the stroke draws once, left to right. */
  fresh?: boolean
  className?: string
}

/**
 * A tipped line: a marker stroke behind the text, cloned across wrapped
 * lines. Colour is never the only cue: every mark carries the nib and its
 * total in marker-ink, and a targeted line gets an underline. The mark is
 * inline text with no handlers, so it never hides or delays reading; the
 * surface adds selection and targeting around it.
 */
export function PassageMark({
  children,
  heat = 3,
  total,
  totalLabel,
  targeted,
  fresh,
  className,
}: PassageMarkProps) {
  return (
    <>
      <mark
        className={cx('qt-mark', className)}
        data-heat={heat}
        data-targeted={targeted || undefined}
        data-fresh={fresh || undefined}
      >
        {children}
      </mark>
      {total ? (
        <span className="qt-mark__total">
          <Icon icon={TipIcon} size={16} />
          <span aria-hidden={totalLabel ? true : undefined}>{total}</span>
          {totalLabel ? (
            <span className="qt-visually-hidden">{totalLabel}</span>
          ) : null}
        </span>
      ) : null}
    </>
  )
}
