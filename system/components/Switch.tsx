'use client'

import { useId, type ReactNode } from 'react'
import { cx } from '../cx'
import { Spinner } from './Spinner'

type SwitchProps = {
  /** What the setting is, always visible: "Show my name on tips". */
  label: string
  /** One line under the label: what on means. */
  description?: ReactNode
  checked: boolean
  onChange: (next: boolean) => void
  disabled?: boolean
  /** The setting is saving: presses wait, a busy mark shows. */
  pending?: boolean
  /** Why the last change did not save. The switch shows the value it had. */
  error?: ReactNode
  className?: string
}

/**
 * A setting that is on or off. The whole row is one control (at least 44 px
 * tall) with role `switch`: Space or Enter toggles it. The state is said in
 * words beside the track ("On", "Off") and by the thumb's side, never by
 * colour alone. Controlled: pair it with `useSwitchSetting` to save, show
 * the pending state and restore the previous value when saving fails.
 */
export function Switch({
  label,
  description,
  checked,
  onChange,
  disabled,
  pending,
  error,
  className,
}: SwitchProps) {
  const labelId = useId()
  const descriptionId = useId()
  const errorId = useId()
  const describedBy =
    [description ? descriptionId : null, error ? errorId : null]
      .filter(Boolean)
      .join(' ') || undefined
  return (
    <div
      className={cx('qt-switch', className)}
      data-invalid={error ? '' : undefined}
    >
      <button
        type="button"
        role="switch"
        className="qt-switch__control"
        aria-checked={checked}
        aria-labelledby={labelId}
        aria-describedby={describedBy}
        aria-busy={pending || undefined}
        aria-disabled={pending || undefined}
        disabled={disabled}
        onClick={() => {
          if (!pending) onChange(!checked)
        }}
      >
        <span className="qt-switch__text">
          <span className="qt-switch__label" id={labelId}>
            {label}
          </span>
          {description ? (
            <span className="qt-switch__description" id={descriptionId}>
              {description}
            </span>
          ) : null}
        </span>
        <span className="qt-switch__state" aria-hidden="true">
          {checked ? 'On' : 'Off'}
        </span>
        <span className="qt-switch__track" aria-hidden="true">
          <span className="qt-switch__thumb">
            {pending ? <Spinner /> : null}
          </span>
        </span>
      </button>
      {error ? (
        <p className="qt-switch__error" id={errorId} role="alert">
          {error}
        </p>
      ) : null}
    </div>
  )
}
