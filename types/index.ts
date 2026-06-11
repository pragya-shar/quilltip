import type { JSONContent } from '@tiptap/react'
import type { ArticleBySlug, Id } from '@/types/convex'

export interface ArticleForDisplay {
  id: string
  slug: string
  title: string
  excerpt?: string | null
  coverImage?: string | null
  publishedAt: Date | string | null
  author: {
    id: string
    name?: string | null
    username: string
    avatar?: string | null
    bio?: string | null
  }
  tags: Array<{
    id: string
    name: string
    slug: string
  }>
  readTime?: number
  tipCount?: number
  highlightCount?: number
  content?: JSONContent
  tipStats?: ArticleBySlug['tipStats']
}

export interface Tag {
  _id: Id<'tags'>
  _creationTime: number
  name: string
  slug: string
  articleCount?: number
  description?: string
  color?: string
}
