'use client'

export function ArticleSidebarSectionFallback() {
  return (
    <div className="rounded-lg border border-border bg-muted p-6 text-center">
      <p className="font-medium text-foreground">Unable to load this panel.</p>
      <p className="mt-2 text-sm text-muted-foreground">
        Tips, stats, and related tools are unavailable right now.
      </p>
    </div>
  )
}
