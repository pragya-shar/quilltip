import * as React from 'react'

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { cn } from '@/lib/utils'

type ActionableNoticeProps = {
  intent: 'actionable' | 'informational'
  children: React.ReactNode
  title?: string
  className?: string
  alertVariant?: 'default' | 'destructive'
}

export function ActionableNotice({
  intent,
  children,
  title,
  className,
  alertVariant = 'default',
}: ActionableNoticeProps) {
  if (intent === 'informational') {
    return (
      <p className={cn('text-sm text-muted-foreground', className)}>
        {children}
      </p>
    )
  }

  return (
    <Alert variant={alertVariant} className={className}>
      {title ? <AlertTitle>{title}</AlertTitle> : null}
      <AlertDescription>{children}</AlertDescription>
    </Alert>
  )
}
