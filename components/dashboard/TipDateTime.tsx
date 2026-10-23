'use client'

import { formatDistanceToNow } from 'date-fns'

function formatTipDate(createdAt: number) {
  const tipDate = new Date(createdAt)
  const relative = formatDistanceToNow(tipDate, { addSuffix: true })
  const absolute = tipDate.toLocaleDateString('en-US', { dateStyle: 'long' })
  const a11yLabel = `${relative}. ${absolute}.`
  return { tipDate, relative, absolute, a11yLabel }
}

export function TipDateTime({ createdAt }: { createdAt: number }) {
  const { tipDate, relative, absolute, a11yLabel } = formatTipDate(createdAt)
  return (
    <time
      dateTime={tipDate.toISOString()}
      title={absolute}
      aria-label={a11yLabel}
      className="text-xs text-muted-foreground"
    >
      {relative}
    </time>
  )
}
