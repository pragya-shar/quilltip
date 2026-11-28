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
  /** What is wrong and how to fix it. Shown under the field, announced. */
  error?: ReactNode
  /** A fixed mark inside the field before the text: "$", "@". */
  prefix?: string
  className?: string
  ref?: Ref<HTMLInputElement>
}

/**
 * A labelled text field: label, input, hint and error, wired for screen
 * readers. The input is at least 16 px (no iOS zoom) and 48 px tall. Show
 * an error after the reader leaves the field or submits, not while typing.
 */
export function TextField({
  label,
  hint,
  error,
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
      {error ? (
        <p className="qt-field__error" id={errorId} role="alert">
          {error}
        </p>
      ) : null}
    </div>
  )
}
