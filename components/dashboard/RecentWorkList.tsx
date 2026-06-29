'use client'

import Link from 'next/link'
import { formatDistanceToNow } from 'date-fns'
import { useCreatorRecentWork } from '@/hooks/convex'
import type { Id } from '@/types/convex'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'

type CreatorWorkItem = {
  _id: Id<'articles'>
  title: string
  excerpt?: string
  published: boolean
  updatedAt: number
  slug: string
  authorUsername: string
}

type RecentWorkListProps = {
  username: string
  hasDrafts: boolean
}

function WorkStatusBadge({ published }: { published: boolean }) {
  return (
    <span
      className={cn(
        'inline-flex shrink-0 rounded-md px-2 py-0.5 text-xs font-medium',
        published
          ? 'bg-success/10 text-success-foreground'
          : 'bg-warning/10 text-warning-foreground'
      )}
    >
      {published ? 'Published' : 'Draft'}
    </span>
  )
}

function getWorkHref(item: CreatorWorkItem): string {
  if (item.published) {
    return `/${item.authorUsername}/${item.slug}`
  }
  return `/write?id=${item._id}`
}

function RecentWorkRow({ item }: { item: CreatorWorkItem }) {
  const editedLabel = formatDistanceToNow(new Date(item.updatedAt), {
    addSuffix: true,
  })
  const title = item.title?.trim() || 'Untitled'

  return (
    <Link
      href={getWorkHref(item)}
      className="group block rounded-lg border border-transparent px-3 py-3 transition-colors hover:border-border hover:bg-muted/40"
    >
      <div className="flex items-start justify-between gap-3">
        <h3 className="min-w-0 flex-1 font-semibold text-foreground group-hover:text-brand-blue line-clamp-1">
          {title}
        </h3>
        <WorkStatusBadge published={item.published} />
      </div>
      <p className="mt-1 text-xs text-muted-foreground">Edited {editedLabel}</p>
      {item.excerpt && (
        <p className="mt-2 line-clamp-1 text-sm text-muted-foreground">
          {item.excerpt}
        </p>
      )}
    </Link>
  )
}

function RecentWorkListSkeleton() {
  return (
    <div className="space-y-1">
      {Array.from({ length: 3 }).map((_, i) => (
        <div key={i} className="px-3 py-3">
          <Skeleton className="mb-2 h-5 w-2/3" />
          <Skeleton className="h-3 w-24" />
        </div>
      ))}
    </div>
  )
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
            className="shrink-0 text-sm font-medium text-brand-blue hover:text-brand-accent"
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
            className="text-sm font-medium text-brand-blue hover:text-brand-accent"
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
