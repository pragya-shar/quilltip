'use client'

import Link from 'next/link'

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

interface EditorWorkspaceErrorFallbackProps {
  onRetry: () => void
}

export function EditorWorkspaceErrorFallback({
  onRetry,
}: EditorWorkspaceErrorFallbackProps) {
  return (
    <div className="flex min-h-[50vh] flex-col items-center justify-center px-4 pb-16 pt-8">
      <div className="max-w-md rounded-lg border border-border bg-muted p-8 text-center">
        <p className="font-medium text-foreground">The editor hit an error.</p>
        <p className="mt-2 text-sm text-muted-foreground">
          Your work may still be saved if auto-save ran. Try reloading the
          editor or return home.
        </p>
        <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
          <button
            type="button"
            onClick={onRetry}
            className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
          >
            Try again
          </button>
          <Link
            href="/"
            className="text-sm font-medium text-primary underline-offset-4 hover:underline"
          >
            Go home
          </Link>
        </div>
      </div>
    </div>
  )
}
