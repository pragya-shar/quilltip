'use client'

import {
  useId,
  type InputHTMLAttributes,
  type ReactNode,
  type Ref,
} from 'react'
import { cx } from '../cx'

type TextFieldProps = Omit<
  InputHTMLAttributes<HTMLInputElement>,
  'className' | 'size' | 'prefix'
> & {
  /** Always visible above the field. A placeholder is never the label. */
  label: string
  /** Help under the field, always visible. */
  hint?: ReactNode
  /** What is wrong and how to fix it. Shown under the field, and read once:
   * see `errorAnnouncement`. */
  error?: ReactNode
  /**
   * How the error is read, once. `focus` (default): the form moves focus to
   * the field (the first invalid one on submit), and the reader hears the
   * error through `aria-describedby` with "invalid"; no live region repeats
   * it. `live`: focus does not move to the field (an error shown while the
   * reader is elsewhere, or after a server answer): a polite live region,
   * present before the error, says it.
   */
  errorAnnouncement?: 'focus' | 'live'
  /** A fixed mark inside the field before the text: "$", "@". */
  prefix?: string
  className?: string
  ref?: Ref<HTMLInputElement>
}

/**
 * A labelled text field: label, input, hint and error, wired for screen
 * readers. The input is at least 16 px (no iOS zoom) and 48 px tall. Show
 * an error after the reader leaves the field or submits, not while typing.
 * On submit, move focus to the first invalid field; the error is read with
 * it, once.
 */
export function TextField({
  label,
  hint,
  error,
  errorAnnouncement = 'focus',
  prefix,
  className,
  id,
  ref,
  ...input
}: TextFieldProps) {
  const auto = useId()
  const inputId = id ?? auto
  const hintId = `${inputId}-hint`
  const errorId = `${inputId}-error`
  const describedBy =
    [hint ? hintId : null, error ? errorId : null].filter(Boolean).join(' ') ||
    undefined
  return (
    <div
      className={cx('qt-field', className)}
      data-invalid={error ? '' : undefined}
    >
      <label className="qt-field__label" htmlFor={inputId}>
        {label}
      </label>
      <div className="qt-field__control">
        {prefix ? (
          <span className="qt-field__prefix" aria-hidden="true">
            {prefix}
          </span>
        ) : null}
        <input
          {...input}
          ref={ref}
          id={inputId}
          className="qt-field__input"
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
        />
      </div>
      {hint ? (
        <p className="qt-field__hint" id={hintId}>
          {hint}
        </p>
      ) : null}
      {errorAnnouncement === 'live' ? (
        // Present before any error, so a screen reader hears it arrive.
        <p
          className="qt-field__error"
          id={errorId}
          aria-live="polite"
          data-empty={error ? undefined : ''}
        >
          {error}
        </p>
      ) : error ? (
        <p className="qt-field__error" id={errorId}>
          {error}
        </p>
      ) : null}
    </div>
  )
}
