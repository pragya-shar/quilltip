'use client'

import { useEffect, useState } from 'react'
import { type JSONContent } from '@tiptap/core'
import Link from 'next/link'
import { ArticleReaderHeader } from './ArticleReaderHeader'
import { ArticleSelectionHint } from './ArticleSelectionHint'
import { BookmarkButton } from '@/components/library/BookmarkButton'
import { ArticleReadOnlyBody } from '@/components/articles/ArticleReadOnlyBody'
import type { HighlightableArticle as HighlightableArticleComponent } from '@/components/articles/HighlightableArticle'
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
  // The highlight editor is browser-only. Until its code loads, show the same
  // content as static HTML so the server response carries the article text.
  const [HighlightableArticle, setHighlightableArticle] = useState<
    typeof HighlightableArticleComponent | null
  >(null)
  useEffect(() => {
    if (!showHighlights) return
    let active = true
    import('@/components/articles/HighlightableArticle')
      .then((mod) => {
        if (active) setHighlightableArticle(() => mod.HighlightableArticle)
      })
      .catch((error) => {
        // The static body stays readable; only highlighting is unavailable.
        console.error('Could not load the highlight editor', error)
      })
    return () => {
      active = false
    }
  }, [showHighlights])
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
        {showHighlights && HighlightableArticle ? (
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
