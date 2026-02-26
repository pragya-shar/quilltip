// Type definitions for QuillTip
import { Id } from '@/convex/_generated/dataModel'

// Convex User type (matches schema)
export interface User {
  _id: Id<'users'>
  _creationTime: number
  email: string
  username: string
  name?: string
  bio?: string
  avatar?: string
  stellarAddress?: string | null
  articleCount?: number
  highlightCount?: number
  tipsSentCount?: number
  tipsReceivedCount?: number
  nftsCreated?: number
  nftsOwned?: number
  createdAt: number
  updatedAt: number
}

// Convex Article type (matches schema)
export interface Article {
  _id: Id<'articles'>
  _creationTime: number
  slug: string
  title: string
  content: Record<string, unknown> // TipTap JSON content
  excerpt?: string
  coverImage?: string
  published: boolean
  publishedAt?: number
  authorId: Id<'users'>
  authorUsername: string
  authorName?: string
  authorAvatar?: string
  tags?: string[]
  viewCount?: number
  highlightCount?: number
  tipCount?: number
  totalTipsUsd?: number
  hasNft?: boolean
  nftId?: Id<'articleNFTs'>
  readTime?: number
  createdAt: number
  updatedAt: number
}

// Frontend-friendly article interface for components
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
  }
  tags: Array<{
    id: string
    name: string
    slug: string
  }>
}

// Tag type (matches schema)
export interface Tag {
  _id: Id<'tags'>
  _creationTime: number
  name: string
  slug: string
  articleCount?: number
  description?: string
  color?: string
}
