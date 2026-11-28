import type { ReactNode } from 'react'

export function AccountField({
  id,
  label,
  error,
  reserveError,
  action,
  children,
}: {
  id: string
  label: string
  error?: string
  /**
   * The longest error the field can show. Its room is kept under the field
   * even with no error, so a field that checks itself as it loses focus
   * does not move the button being pressed (#658).
   */
  reserveError?: string
  action?: ReactNode
  children: ReactNode
}) {
  return (
    <div className="account-field">
      <div className="account-label-row">
        <label htmlFor={id}>{label}</label>
        {action}
      </div>
      {children}
      {reserveError !== undefined ? (
        <div className="account-error-slot">
          {error && (
            <p id={`${id}-error`} className="account-error">
              {error}
            </p>
          )}
          <p className="account-error" data-sizer="" aria-hidden="true">
            {reserveError}
          </p>
        </div>
      ) : (
        error && (
          <p id={`${id}-error`} className="account-error">
            {error}
          </p>
        )
      )}
    </div>
  )
}
