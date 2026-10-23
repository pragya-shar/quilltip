import type { ReactNode } from 'react'

type FailurePageShellProps = {
  label: string
  heading: ReactNode
  description?: ReactNode
  actions: ReactNode
}

export function FailurePageShell({
  label,
  heading,
  description,
  actions,
}: FailurePageShellProps) {
  return (
    <div className="failure-page">
      <div className="failure-page-content">
        <p className="failure-label">{label}</p>
        {heading}
        {description ? (
          <div className="failure-description">{description}</div>
        ) : null}
        <div className="failure-actions">{actions}</div>
      </div>
    </div>
  )
}
