'use client'

import { SectionFailure } from './SectionFailure'

export function ArticleSidebarSectionFallback({
  onRetry,
}: {
  onRetry: () => void
}) {
  return (
    <SectionFailure
      title="Unable to load this panel."
      description="Article details and related tools are unavailable right now. You can keep reading."
      onRetry={onRetry}
    />
  )
}
