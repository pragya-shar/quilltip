'use client'

import dynamic from 'next/dynamic'
import { useState } from 'react'
import { type JSONContent } from '@tiptap/core'
import Link from 'next/link'
import { ArticleReaderHeader } from './ArticleReaderHeader'
import { ArticleSelectionHint } from './ArticleSelectionHint'
import { BookmarkButton } from '@/components/library/BookmarkButton'
import { ArticleReadOnlyBody } from '@/components/articles/ArticleReadOnlyBody'
import { ArticleBodySkeleton } from '@/components/articles/ArticleBodySkeleton'
const HighlightableArticle = dynamic(
  () =>
    import('@/components/articles/HighlightableArticle').then((mod) => ({
      default: mod.HighlightableArticle,
    })),
  { ssr: false, loading: () => <ArticleBodySkeleton /> }
)
import type { Id } from '@/types/convex'
import type { ArticleForDisplay } from '@/types/index'
import { estimateArticleReadingMinutes } from '@/lib/reading-time'
import type { TocHeading } from '@/lib/tiptap/headings'
import { useEnsureHeadingIds } from '@/components/articles/useEnsureHeadingIds'

const EMPTY_DOC: JSONContent = { type: 'doc', content: [] }

interface ArticleDisplayProps {
  article: ArticleForDisplay
  authorStellarAddress?: string | null
  showHighlights?: boolean
  tocHeadings?: TocHeading[]
  readerSupport?: React.ReactNode
  readNext?: React.ReactNode
}

export default function ArticleDisplay({
  article,
  authorStellarAddress: _authorStellarAddress,
  showHighlights = true,
  tocHeadings = [],
  readerSupport,
  readNext,
}: ArticleDisplayProps) {
  const [passageRailTarget, setPassageRailTarget] =
    useState<HTMLDivElement | null>(null)
  const readingMinutes = estimateArticleReadingMinutes(article.content)

  useEnsureHeadingIds(tocHeadings, { rootSelector: '.article-content' })

  return (
    <article className="reader-article">
      {showHighlights && (
        <div className="reader-passage-slot" ref={setPassageRailTarget} />
      )}
      <ArticleReaderHeader
        title={article.title}
        subtitle={article.excerpt}
        topic={article.tags[0]?.name}
        author={
          <Link href={`/${encodeURIComponent(article.author.username)}`}>
            {article.author.name || article.author.username}
          </Link>
        }
        readingMinutes={readingMinutes}
        bookmark={
          <BookmarkButton
            article={{
              id: article.id,
              title: article.title,
              author: article.author.name || article.author.username,
              username: article.author.username,
              slug: article.slug,
              topic: article.tags[0]?.name || 'Article',
              minutes: readingMinutes,
            }}
          />
        }
      />

      {showHighlights && <ArticleSelectionHint />}

      <div className="article-content">
        {showHighlights ? (
          <>
            <HighlightableArticle
              articleId={article.id as Id<'articles'>}
              content={article.content ?? EMPTY_DOC}
              editable={false}
              showHighlights={showHighlights}
              tocHeadings={tocHeadings}
              passageRailTarget={passageRailTarget}
            />
          </>
        ) : (
          <ArticleReadOnlyBody
            content={article.content ?? EMPTY_DOC}
            tocHeadings={tocHeadings}
          />
        )}
      </div>

      <footer className="reader-end-matter">
        {readerSupport}
        <p className="reader-endmark" aria-hidden="true">
          ◇
        </p>
        <p className="reader-author-end">
          By{' '}
          <Link href={`/${encodeURIComponent(article.author.username)}`}>
            {article.author.name || article.author.username}
          </Link>
        </p>
        {readNext}
      </footer>
    </article>
  )
}
