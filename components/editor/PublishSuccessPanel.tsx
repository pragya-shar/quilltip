'use client'

import Link from 'next/link'
import { ExternalLink, CheckCircle2, Loader2 } from 'lucide-react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import ShareButtons from '@/components/articles/ShareButtons'
import {
  buildArticlePublicPath,
  buildArticlePublicUrl,
} from '@/lib/articles/public-url'

type PublishSuccessPanelProps = {
  title: string
  excerpt?: string | null
  username: string | null
  slug: string | null
  origin: string | null
  onDismiss: () => void
  onLeave: () => void
}

export function PublishSuccessPanel({
  title,
  excerpt,
  username,
  slug,
  origin,
  onDismiss,
  onLeave,
}: PublishSuccessPanelProps) {
  const hasLinkParts = Boolean(username && slug)
  const publicPath = hasLinkParts
    ? buildArticlePublicPath(username!, slug!)
    : null
  const publicUrl =
    hasLinkParts && origin
      ? buildArticlePublicUrl(origin, username!, slug!)
      : null

  return (
    <Alert className="border-success/30 bg-success/10">
      <CheckCircle2 className="h-4 w-4 text-success" />
      <div className="flex min-w-0 flex-col gap-3">
        <div className="min-w-0">
          <AlertTitle className="text-success">Article published</AlertTitle>
          <AlertDescription>
            {publicUrl ? (
              <div className="mt-1 min-w-0 font-mono text-xs text-muted-foreground">
                <span className="block truncate" title={publicUrl}>
                  {publicUrl}
                </span>
              </div>
            ) : (
              <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
                <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                <span>Preparing your link…</span>
              </div>
            )}
          </AlertDescription>
        </div>

        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            {publicPath ? (
              <Link
                href={publicPath}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 rounded-full bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
              >
                View article
                <ExternalLink className="h-4 w-4" aria-hidden />
              </Link>
            ) : (
              <button
                type="button"
                disabled
                className="inline-flex items-center gap-2 rounded-full bg-muted px-4 py-2 text-sm font-medium text-muted-foreground opacity-70"
                aria-busy="true"
              >
                View article
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
              </button>
            )}
          </div>

          {publicUrl ? (
            <ShareButtons
              title={title}
              url={publicUrl}
              excerpt={excerpt}
              className="min-w-0"
            />
          ) : null}
        </div>

        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-end sm:gap-3">
          <button
            type="button"
            onClick={onDismiss}
            className="rounded-md px-3 py-1.5 text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
          >
            Keep editing this article
          </button>
          <button
            type="button"
            onClick={onLeave}
            className="rounded-md px-3 py-1.5 text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
          >
            Leave editor
          </button>
        </div>
      </div>
    </Alert>
  )
}
