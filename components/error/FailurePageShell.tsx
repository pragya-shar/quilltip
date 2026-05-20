import type { ReactNode } from 'react'

import { cn } from '@/lib/utils'

type FailurePageShellProps = {
  illustration?: ReactNode
  heading: ReactNode
  description?: ReactNode
  actions: ReactNode
  actionsClassName?: string
  className?: string
}

export function FailurePageShell({
  illustration,
  heading,
  description,
  actions,
  actionsClassName,
  className,
}: FailurePageShellProps) {
  return (
    <div
      className={cn(
        'flex min-h-screen flex-col items-center justify-center bg-background px-4 py-8 sm:px-6 sm:py-12',
        className
      )}
    >
      <div className="mx-auto w-full max-w-md rounded-[var(--card-radius)] border border-border bg-card p-6 text-center shadow-[var(--card-shadow)] sm:p-8">
        {illustration}
        <div className="space-y-2">{heading}</div>
        {description ? (
          <div className="mt-3 text-sm text-muted-foreground">{description}</div>
        ) : null}
        <div
          className={cn(
            'mt-8 flex w-full flex-col items-center gap-3 sm:flex-row sm:justify-center',
            actionsClassName
          )}
        >
          {actions}
        </div>
      </div>
    </div>
  )
}
