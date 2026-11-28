// @vitest-environment happy-dom
import { createElement, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ArticleListingThumbnail } from '../../components/articles/ArticleListingThumbnail'
import { ReadingRoomCard } from '../../components/articles/ReadingRoomCard'
import { LandingProofArticleCard } from '../../components/landing/LandingProofArticleCard'
import { NftCard } from '../../components/nft/NftCard'
import { shownCoverImage } from '../../lib/tiptap/articleImage'
import type { ArticleForDisplay } from '../../types/index'

// Cards render outside a Next app here: a plain link, a signed-out reader.
vi.mock('next/link', () => ({
  default: ({
    children,
    href,
    ...props
  }: {
    children: ReactNode
    href: string
  }) => createElement('a', { href, ...props }, children),
}))
// Styles play no part here; the unit config has no CSS pipeline.
vi.mock('../../components/nft/nft-card.css', () => ({}))
vi.mock('@/components/providers/AuthContext', () => ({
  useAuth: () => ({ user: null, isLoading: false }),
}))

const OWN = 'https://own-deployment-123.convex.cloud'
const own = `${OWN}/api/storage/5c1e2f0a-cover`
const otherConvex = 'https://someone-else-456.convex.cloud/api/storage/cover'

beforeEach(() => vi.stubEnv('NEXT_PUBLIC_CONVEX_URL', OWN))
afterEach(() => vi.unstubAllEnvs())

const article = (coverImage: string): ArticleForDisplay => ({
  id: 'a1',
  slug: 'covers',
  title: 'Covers of words',
  excerpt: 'A short piece about covers.',
  coverImage,
  publishedAt: '2026-11-28T00:00:00.000Z',
  author: { id: 'u1', name: 'Cover Writer', username: 'cover-writer' },
  tags: [],
})

const cards: [string, (cover: string) => ReturnType<typeof createElement>][] = [
  [
    'ReadingRoomCard',
    (cover) =>
      createElement(ReadingRoomCard, {
        article: article(cover),
        index: 0,
        onNavigate: () => {},
        onAuthor: () => {},
      }),
  ],
  [
    'ArticleListingThumbnail (feed)',
    (cover) =>
      createElement(ArticleListingThumbnail, {
        title: 'Covers of words',
        coverImage: cover,
        href: '/cover-writer/covers',
        variant: 'feed',
      }),
  ],
  [
    'ArticleListingThumbnail (card)',
    (cover) =>
      createElement(ArticleListingThumbnail, {
        title: 'Covers of words',
        coverImage: cover,
        href: '/cover-writer/covers',
        variant: 'card',
      }),
  ],
  [
    'LandingProofArticleCard',
    (cover) =>
      createElement(LandingProofArticleCard, { article: article(cover) }),
  ],
  [
    'NftCard',
    (cover) =>
      createElement(NftCard, {
        title: 'Covers of words',
        coverImage: cover,
        tokenId: '1',
        footerLabel: 'Owner',
      }),
  ],
]

describe('article covers (#615)', () => {
  it('a cover from another host counts as no cover', () => {
    expect(shownCoverImage(own)).toBe(own)
    expect(shownCoverImage(otherConvex)).toBeUndefined()
    expect(shownCoverImage('')).toBeUndefined()
    expect(shownCoverImage(null)).toBeUndefined()
  })

  it.each(cards)(
    '%s shows an own-storage cover and no cover from another host',
    (_, card) => {
      const ownHtml = renderToStaticMarkup(card(own))
      expect(ownHtml).toContain(encodeURIComponent(own))
      const otherHtml = renderToStaticMarkup(card(otherConvex))
      expect(otherHtml).not.toContain('someone-else-456')
      expect(otherHtml).not.toContain(encodeURIComponent(otherConvex))
    }
  )

  it('the article page metadata names no cover from another host', async () => {
    const { readFileSync } = await import('node:fs')
    const { join } = await import('node:path')
    const page = readFileSync(
      join(__dirname, '../../app/[username]/[slug]/page.tsx'),
      'utf8'
    )
    expect(page).toContain('const cover = shownCoverImage(article.coverImage)')
    expect(page).toContain(
      'const images = cover ? [{ url: cover }] : undefined'
    )
    // The article sent to the page carries no outside cover either.
    expect(page).toContain(
      'coverImage: shownCoverImage(initialArticle.coverImage),'
    )
  })

  it('the writing workspace uses the same check', async () => {
    const { readFileSync } = await import('node:fs')
    const { join } = await import('node:path')
    const workspace = readFileSync(
      join(__dirname, '../../components/editor/WritingWorkspaceView.tsx'),
      'utf8'
    )
    expect(workspace).toContain('if (shownCoverImage(w.coverImage)) {')
    expect(workspace).toContain('{shownCoverImage(w.coverImage) ? (')
  })
})
