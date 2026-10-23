'use client'

import Link from 'next/link'
import { useCreatorRecentWork } from '@/hooks/convex'
import { RecentWorkListSkeleton } from '@/components/dashboard/RecentWorkListSkeleton'
import { RecentWorkRow } from '@/components/dashboard/RecentWorkRow'

type RecentWorkListProps = {
  username: string
  hasDrafts: boolean
}

export function RecentWorkList({ username, hasDrafts }: RecentWorkListProps) {
  const recentWork = useCreatorRecentWork({ limit: 5 })

  if (recentWork === undefined) {
    return (
      <section>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-foreground">
            Your recent work
          </h2>
        </div>
        <div className="rounded-[var(--card-radius)] border border-border bg-card shadow-[var(--card-shadow)]">
          <RecentWorkListSkeleton />
        </div>
      </section>
    )
  }

  const footerHref = hasDrafts ? '/drafts' : `/${username}?tab=articles`
  const footerLabel = hasDrafts ? 'View all drafts' : 'View published articles'

  return (
    <section>
      <div className="mb-4 flex items-center justify-between gap-4">
        <h2 className="text-lg font-semibold text-foreground">
          Your recent work
        </h2>
        {recentWork.length > 0 && (
          <Link
            href={footerHref}
            className="shrink-0 text-sm font-medium text-primary hover:text-foreground"
          >
            {footerLabel}
          </Link>
        )}
      </div>

      {recentWork.length === 0 ? (
        <div className="rounded-[var(--card-radius)] border border-border bg-card p-8 text-center shadow-[var(--card-shadow)]">
          <p className="mb-3 text-muted-foreground">
            No articles yet. Start writing to see your work here.
          </p>
          <Link
            href="/write"
            className="text-sm font-medium text-primary hover:text-foreground"
          >
            Start your first article
          </Link>
        </div>
      ) : (
        <div className="divide-y divide-border rounded-[var(--card-radius)] border border-border bg-card shadow-[var(--card-shadow)]">
          {recentWork.map((item) => (
            <RecentWorkRow key={item._id} item={item} />
          ))}
        </div>
      )}
    </section>
  )
}
