'use client'

export function DashboardRecentArticlesFallback() {
  return (
    <div className="rounded-lg border border-border bg-muted p-6 text-center">
      <p className="font-medium text-foreground">
        Recent articles unavailable.
      </p>
      <p className="mt-2 text-sm text-muted-foreground">
        We could not load your feed. Try again in a moment.
      </p>
    </div>
  )
}
