'use client'

import { useId, type ReactNode } from 'react'
import { cx } from '../cx'
import { useModal } from './useModal'

type DialogProps = {
  open: boolean
  onClose: () => void
  title: ReactNode
  description?: ReactNode
  /** Buttons, the safe choice last (nearest the thumb and the default). */
  actions: ReactNode
  /** alert: a decision the reader must make; the scrim does not close it. */
  role?: 'dialog' | 'alertdialog'
  className?: string
}

/**
 * A short question in the centre of the screen: a title, a sentence and two
 * buttons. For anything longer use Sheet. Modal, with focus kept inside and
 * returned on close; Escape closes it.
 */
export function Dialog({
  open,
  onClose,
  title,
  description,
  actions,
  role = 'dialog',
  className,
}: DialogProps) {
  const ref = useModal(open, onClose)
  const titleId = useId()
  const descriptionId = useId()
  return (
    // The scrim press is the pointer twin of Escape, which the dialog
    // already handles from the keyboard (useModal).
    // eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-noninteractive-element-interactions
    <dialog
      ref={ref}
      role={role === 'alertdialog' ? 'alertdialog' : undefined}
      className={cx('qt-modal', className)}
      data-kind="dialog"
      aria-labelledby={titleId}
      aria-describedby={description ? descriptionId : undefined}
      onClick={(event) => {
        if (role === 'dialog' && event.target === event.currentTarget) onClose()
      }}
    >
      <div className="qt-modal__panel">
        <div className="qt-modal__titles">
          <h2 className="qt-modal__title" id={titleId}>
            {title}
          </h2>
          {description ? (
            <p className="qt-modal__description" id={descriptionId}>
              {description}
            </p>
          ) : null}
        </div>
        <div className="qt-modal__actions" data-layout="row">
          {actions}
        </div>
      </div>
    </dialog>
  )
}
