'use client'

import type { Id } from '@/convex/_generated/dataModel'

export interface ArticleTipActionsProps {
  articleId: Id<'articles'>
  articleSlug: string
  authorName: string
  authorStellarAddress?: string | null
}
