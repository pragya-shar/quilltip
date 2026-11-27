'use client'

import { useId, useRef, type PointerEvent, type ReactNode } from 'react'
import { cx } from '../cx'
import { CloseIcon } from '../icons'
import { Icon } from './Icon'
import { useModal } from './useModal'

type SheetProps = {
  open: boolean
  onClose: () => void
  title: ReactNode
  /** One line under the title. */
  description?: ReactNode
  /** The footer: the sheet's one primary action, and at most one more. */
  actions?: ReactNode
  /** Hides the title visually; it stays the sheet's accessible name. */
  hideTitle?: boolean
  className?: string
  children?: ReactNode
}

/** Distance (share of the sheet's height) or speed that dismisses a drag. */
const DISMISS_SHARE = 0.25
const DISMISS_SPEED = 0.6 // px per ms

/**
 * A bottom sheet on a phone, a centred panel from 40rem. Modal: focus stays
 * inside, Escape and the visible close button close it, focus returns to
 * what opened it, and the page behind does not scroll. On touch, the grip
 * and header drag down to dismiss; the close button is always there too.
 */
export function Sheet({
  open,
  onClose,
  title,
  description,
  actions,
  hideTitle,
  className,
  children,
}: SheetProps) {
  const ref = useModal(open, onClose)
  const titleId = useId()
  const descriptionId = useId()
  const panel = useRef<HTMLDivElement>(null)
  const drag = useRef<{ y: number; t: number; dy: number } | null>(null)

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.pointerType === 'mouse' || event.button !== 0) return
    if ((event.target as HTMLElement).closest('button, a, input')) return
    drag.current = { y: event.clientY, t: event.timeStamp, dy: 0 }
    event.currentTarget.setPointerCapture(event.pointerId)
    panel.current?.setAttribute('data-dragging', '')
  }
  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const state = drag.current
    if (!state || !panel.current) return
    // Down follows the finger; up resists.
    const raw = event.clientY - state.y
    state.dy = raw > 0 ? raw : raw / 6
    panel.current.style.transform = `translateY(${state.dy}px)`
  }
  const onPointerEnd = (event: PointerEvent<HTMLDivElement>) => {
    const state = drag.current
    drag.current = null
    const node = panel.current
    if (!state || !node) return
    node.removeAttribute('data-dragging')
    const speed = state.dy / Math.max(1, event.timeStamp - state.t)
    const far = state.dy > node.offsetHeight * DISMISS_SHARE
    node.style.transform = ''
    if (far || speed > DISMISS_SPEED) onClose()
  }

  return (
    // The scrim press is the pointer twin of Escape, which the dialog
    // already handles from the keyboard (useModal).
    // eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-noninteractive-element-interactions
    <dialog
      ref={ref}
      className={cx('qt-modal', className)}
      data-kind="sheet"
      aria-labelledby={titleId}
      aria-describedby={description ? descriptionId : undefined}
      onClick={(event) => {
        // A press on the scrim (the dialog itself, outside the panel).
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div className="qt-modal__panel" ref={panel}>
        <div
          className="qt-modal__head"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerEnd}
          onPointerCancel={onPointerEnd}
        >
          <span className="qt-modal__grip" aria-hidden="true" />
          <div
            className="qt-modal__titles"
            data-hidden={hideTitle || undefined}
          >
            <h2 className="qt-modal__title" id={titleId}>
              {title}
            </h2>
            {description ? (
              <p className="qt-modal__description" id={descriptionId}>
                {description}
              </p>
            ) : null}
          </div>
          <button
            type="button"
            className="qt-modal__close"
            aria-label="Close"
            onClick={onClose}
          >
            <Icon icon={CloseIcon} size={24} />
          </button>
        </div>
        {children ? <div className="qt-modal__body">{children}</div> : null}
        {actions ? <div className="qt-modal__actions">{actions}</div> : null}
      </div>
    </dialog>
  )
}
