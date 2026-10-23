'use client'

export function ArticleDisplaySectionFallback() {
  return (
    <div className="rounded-lg border border-border bg-muted p-6 text-center">
      <p className="font-medium text-foreground">
        Unable to display this article.
      </p>
      <p className="mt-2 text-sm text-muted-foreground">
        The article content failed to load. Try refreshing the page.
      </p>
    </div>
  )
}
