'use client'

import Link from 'next/link'
import { BookOpen } from 'lucide-react'
import { useCreatorWorkspaceSummary } from '@/hooks/convex'
import { PrimaryWritingAction } from '@/components/dashboard/PrimaryWritingAction'
import { CompactEarningsCard } from '@/components/dashboard/CompactEarningsCard'
import { RecentWorkList } from '@/components/dashboard/RecentWorkList'
import { ErrorBoundary } from '@/components/error/ErrorBoundary'
import { CreatorWorkspacePanelFallback } from '@/components/error/CreatorWorkspacePanelFallback'
import { CreatorWorkspaceWalletFallback } from '@/components/error/CreatorWorkspaceWalletFallback'
import type { CreatorWorkspaceProps } from '@/components/dashboard/CreatorWorkspaceShared'
import { CreatorWorkspaceSkeleton } from '@/components/dashboard/CreatorWorkspaceSkeleton'

export function CreatorWorkspaceContent({ user }: CreatorWorkspaceProps) {
  const workspaceSummary = useCreatorWorkspaceSummary()
  const displayName = user.name || user.username || user.email

  if (workspaceSummary === undefined) {
    return (
      <>
        <div className="mb-8">
          <h1 className="mb-2 text-3xl font-bold text-foreground">
            Welcome back, {displayName}
          </h1>
          <p className="text-muted-foreground">
            Loading your writing workspace
          </p>
        </div>
        <CreatorWorkspaceSkeleton />
      </>
    )
  }

  const mostRecentDraft = workspaceSummary.mostRecentDraft
  const hasDrafts = workspaceSummary.hasDrafts
  const workspaceSubtitle = hasDrafts
    ? 'Your latest writing is ready when you are'
    : 'Start your first article anytime'

  return (
    <>
      <div className="mb-8">
        <h1 className="mb-2 text-3xl font-bold text-foreground">
          Welcome back, {displayName}
        </h1>
        <p className="text-muted-foreground">{workspaceSubtitle}</p>
      </div>

      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_280px]">
        <div className="space-y-8">
          <PrimaryWritingAction mostRecentDraft={mostRecentDraft} />
          <ErrorBoundary fallback={<CreatorWorkspacePanelFallback />}>
            <RecentWorkList username={user.username} hasDrafts={hasDrafts} />
          </ErrorBoundary>
        </div>

        <aside className="space-y-4">
          <ErrorBoundary fallback={<CreatorWorkspaceWalletFallback />}>
            <CompactEarningsCard user={user} />
          </ErrorBoundary>
          <Link
            href="/articles"
            className="flex items-center gap-2 rounded-[var(--card-radius)] border border-border bg-card px-4 py-3 text-sm text-muted-foreground shadow-[var(--card-shadow)] transition-colors hover:border-border hover:bg-muted/40 hover:text-foreground"
          >
            <BookOpen className="h-4 w-4 shrink-0" />
            Browse articles
          </Link>
        </aside>
      </div>
    </>
  )
}
