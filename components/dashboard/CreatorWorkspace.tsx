'use client'

import Link from 'next/link'
import { BookOpen } from 'lucide-react'
import { useCreatorWorkspaceSummary } from '@/hooks/convex'
import type { CurrentUserDoc } from '@/types/convex'
import { PrimaryWritingAction } from '@/components/dashboard/PrimaryWritingAction'
import { CompactEarningsCard } from '@/components/dashboard/CompactEarningsCard'
import { RecentWorkList } from '@/components/dashboard/RecentWorkList'
import { ErrorBoundary } from '@/components/error/ErrorBoundary'
import {
  CreatorWorkspacePanelFallback,
  CreatorWorkspaceWalletFallback,
} from '@/components/error/SectionErrorFallback'
import { Skeleton } from '@/components/ui/skeleton'

type CreatorWorkspaceProps = {
  user: CurrentUserDoc
}

function CreatorWorkspaceSkeleton() {
  return (
    <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_280px]">
      <div className="space-y-8">
        <div className="rounded-[var(--card-radius)] border border-border bg-card p-[var(--card-padding)]">
          <Skeleton className="mb-3 h-4 w-40" />
          <Skeleton className="h-16 w-full" />
        </div>
        <div>
          <Skeleton className="mb-4 h-6 w-36" />
          <div className="space-y-2 rounded-[var(--card-radius)] border border-border bg-card p-2">
            {[0, 1, 2].map((key) => (
              <Skeleton key={key} className="h-14 w-full" />
            ))}
          </div>
        </div>
      </div>
      <Skeleton className="h-36 rounded-[var(--card-radius)]" />
    </div>
  )
}

function CreatorWorkspacePrimaryFallback({ user }: CreatorWorkspaceProps) {
  const displayName = user.name || user.username || user.email

  return (
    <>
      <div className="mb-8">
        <h1 className="mb-2 text-3xl font-bold text-foreground">
          Welcome back, {displayName}
        </h1>
        <p className="text-muted-foreground">Your writing workspace is ready</p>
      </div>

      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_280px]">
        <div className="space-y-8">
          <PrimaryWritingAction mostRecentDraft={null} />
          <CreatorWorkspacePanelFallback />
        </div>

        <aside className="space-y-4">
          {!user.stellarAddress ? (
            <Link
              href="/dashboard/wallet"
              className="block rounded-[var(--card-radius)] border border-border bg-card p-[var(--card-padding)] text-sm text-muted-foreground shadow-[var(--card-shadow)] transition-colors hover:bg-muted/40 hover:text-foreground"
            >
              Set up your receiving wallet to publish tip-ready articles.
            </Link>
          ) : null}
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

function CreatorWorkspaceContent({ user }: CreatorWorkspaceProps) {
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

export function CreatorWorkspace({ user }: CreatorWorkspaceProps) {
  return (
    <ErrorBoundary fallback={<CreatorWorkspacePrimaryFallback user={user} />}>
      <CreatorWorkspaceContent user={user} />
    </ErrorBoundary>
  )
}

export function CreatorWorkspaceLoadingShell() {
  return (
    <div className="animate-pulse">
      <div className="mb-8 space-y-3">
        <div className="h-9 w-64 rounded-lg bg-muted" />
        <div className="h-5 w-48 rounded-lg bg-muted" />
      </div>
      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_280px]">
        <div className="space-y-8">
          <div className="h-36 rounded-[var(--card-radius)] bg-muted" />
          <div>
            <div className="mb-4 h-6 w-40 rounded-lg bg-muted" />
            <div className="space-y-2">
              {[0, 1, 2].map((key) => (
                <div
                  key={key}
                  className="h-16 rounded-[var(--card-radius)] bg-muted"
                />
              ))}
            </div>
          </div>
        </div>
        <div className="h-36 rounded-[var(--card-radius)] bg-muted" />
      </div>
    </div>
  )
}
