'use client'

import { SectionFailure } from './SectionFailure'

export function ArticleDisplaySectionFallback({
  onRetry,
}: {
  onRetry: () => void
}) {
  return (
    <SectionFailure
      title="Unable to display this article."
      description="The article content failed to load. Try again, or reload the page."
      onRetry={onRetry}
    />
  )
}
