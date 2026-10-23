'use client'

import Link from 'next/link'
import { BookOpen } from 'lucide-react'
import { PrimaryWritingAction } from '@/components/dashboard/PrimaryWritingAction'
import { CreatorWorkspacePanelFallback } from '@/components/error/SectionErrorFallback'
import type { CreatorWorkspaceProps } from '@/components/dashboard/CreatorWorkspaceShared'

export function CreatorWorkspacePrimaryFallback({
  user,
}: CreatorWorkspaceProps) {
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
