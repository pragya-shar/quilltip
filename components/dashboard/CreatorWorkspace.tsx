'use client'

import Link from 'next/link'
import { BookOpen } from 'lucide-react'
import { useUserDrafts } from '@/hooks/convex'
import { getMostRecentDraft } from '@/lib/drafts/draftMetadata'
import type { CurrentUserDoc } from '@/types/convex'
import { PrimaryWritingAction } from '@/components/dashboard/PrimaryWritingAction'
import { CompactEarningsCard } from '@/components/dashboard/CompactEarningsCard'
import { RecentWorkList } from '@/components/dashboard/RecentWorkList'
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

export function CreatorWorkspace({ user }: CreatorWorkspaceProps) {
  const draftsQuery = useUserDrafts()
  const displayName = user.name || user.username || user.email

  if (draftsQuery === undefined) {
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

  const mostRecentDraft = getMostRecentDraft(draftsQuery)
  const hasDrafts = draftsQuery.length > 0
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
          <RecentWorkList username={user.username} hasDrafts={hasDrafts} />
        </div>

        <aside className="space-y-4">
          <CompactEarningsCard user={user} />
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
