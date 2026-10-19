import type { ReactNode } from 'react'

export function AccountField({
  id,
  label,
  error,
  action,
  children,
}: {
  id: string
  label: string
  error?: string
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
      {error && (
        <p id={`${id}-error`} className="account-error">
          {error}
        </p>
      )}
    </div>
  )
}
