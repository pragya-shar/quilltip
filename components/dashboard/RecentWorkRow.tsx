'use client'

import Link from 'next/link'
import { formatDistanceToNow } from 'date-fns'
import type { Id } from '@/types/convex'
import { WorkStatusBadge } from '@/components/dashboard/WorkStatusBadge'

type CreatorWorkItem = {
  _id: Id<'articles'>
  title: string
  excerpt?: string
  published: boolean
  updatedAt: number
  slug: string
  authorUsername: string
}

function getWorkHref(item: CreatorWorkItem): string {
  if (item.published) {
    return `/${item.authorUsername}/${item.slug}`
  }
  return `/write?id=${item._id}`
}

export function RecentWorkRow({ item }: { item: CreatorWorkItem }) {
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
