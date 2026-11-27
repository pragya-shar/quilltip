'use client'

import { cx } from '../cx'
import { KeepIcon, KeptIcon } from '../icons'
import { Icon } from './Icon'
import { Spinner } from './Spinner'

type KeepButtonProps = {
  /** The line is kept (saved for free, on the Shelf). */
  kept: boolean
  onChange: (next: boolean) => void
  /** Saving the change: presses wait. */
  pending?: boolean
  /** Shows "Keep" or "Kept" beside the icon; icon only by default. */
  showLabel?: boolean
  disabled?: boolean
  className?: string
}

/**
 * Keep: save a line for free, the action beside the tip. A toggle button
 * (`aria-pressed`), 44 px: the bookmark becomes a bookmark with a check
 * when kept, so the state never rests on colour. Its name stays "Keep
 * this line" and the pressed state says whether it is kept.
 */
export function KeepButton({
  kept,
  onChange,
  pending,
  showLabel,
  disabled,
  className,
}: KeepButtonProps) {
  return (
    <button
      type="button"
      className={cx('qt-keep', className)}
      aria-pressed={kept}
      aria-label={showLabel ? undefined : 'Keep this line'}
      aria-busy={pending || undefined}
      aria-disabled={pending || undefined}
      disabled={disabled}
      data-labelled={showLabel || undefined}
      onClick={() => {
        if (!pending) onChange(!kept)
      }}
    >
      {pending ? (
        <Spinner />
      ) : (
        <Icon icon={kept ? KeptIcon : KeepIcon} size={24} />
      )}
      {showLabel ? (
        <span className="qt-keep__label">{kept ? 'Kept' : 'Keep'}</span>
      ) : null}
    </button>
  )
}
