'use client'

import dynamic from 'next/dynamic'
import { type JSONContent } from '@tiptap/core'
import { useEffect, useState } from 'react'
import { formatDistanceToNow } from 'date-fns'
import Image from 'next/image'
import { UserAvatar } from '@/components/ui/user-avatar'
import ShareButtons from './ShareButtons'
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
import { TagFilterLink } from '@/components/articles/TagFilterLink'
import { extractPlainTextFromTiptapJson } from '@/lib/tiptap/plainText'
import { estimateReadingMinutes } from '@/lib/reading-time'
import type { TocHeading } from '@/lib/tiptap/headings'
import { useEnsureHeadingIds } from '@/components/articles/useEnsureHeadingIds'

const EMPTY_DOC: JSONContent = { type: 'doc', content: [] }

interface ArticleDisplayProps {
  article: ArticleForDisplay
  authorStellarAddress?: string | null
  showHighlights?: boolean
  tocHeadings?: TocHeading[]
}

export default function ArticleDisplay({
  article,
  authorStellarAddress,
  showHighlights = true,
  tocHeadings = [],
}: ArticleDisplayProps) {
  const [currentUrl, setCurrentUrl] = useState('')

  useEffect(() => {
    setCurrentUrl(window.location.href)
  }, [])

  const publishedDate = article.publishedAt
    ? formatDistanceToNow(new Date(article.publishedAt), { addSuffix: true })
    : null

  const readingMinutes = estimateReadingMinutes(
    extractPlainTextFromTiptapJson(article.content)
  )

  useEnsureHeadingIds(tocHeadings, { rootSelector: '.article-content' })

  return (
    <article className="max-w-4xl mx-auto px-4 py-8">
      <header className="mb-8">
        <h1 className="text-3xl md:text-4xl font-semibold text-foreground mb-3 leading-snug">
          {article.title}
        </h1>

        <div className="flex items-center gap-4 mb-6">
          <div className="flex items-center gap-3">
            <UserAvatar
              src={article.author.avatar}
              alt={article.author.name || article.author.username}
              name={article.author.name || article.author.username}
              className="h-12 w-12"
              fallbackClassName="text-base"
            />
            <div>
              <p className="font-medium text-foreground">
                {article.author.name || article.author.username}
              </p>
              <p className="text-sm text-muted-foreground">
                @{article.author.username}
                <span className="mx-1">•</span>
                {publishedDate && (
                  <>
                    {publishedDate}
                    <span className="mx-1">•</span>
                  </>
                )}
                {readingMinutes} min read
              </p>
            </div>
          </div>
        </div>

        {article.coverImage && (
          <div className="relative mb-8 w-full h-64 md:h-96">
            <Image
              src={article.coverImage}
              alt={article.title}
              fill
              sizes="(max-width: 768px) 100vw, 896px"
              priority
              className="object-cover rounded-lg"
            />
          </div>
        )}

        {article.tags.length > 0 && (
          <div className="flex flex-wrap gap-2 mb-6">
            {article.tags.map((tag) => (
              <TagFilterLink
                key={tag.id}
                tag={tag.name}
                className="px-3 py-1 text-sm"
              >
                {tag.name}
              </TagFilterLink>
            ))}
          </div>
        )}
      </header>

      <div className="article-content">
        {showHighlights ? (
          <>
            <HighlightableArticle
              articleId={article.id as Id<'articles'>}
              content={article.content ?? EMPTY_DOC}
              editable={false}
              showHighlights={showHighlights}
              tocHeadings={tocHeadings}
            />
          </>
        ) : (
          <ArticleReadOnlyBody
            content={article.content ?? EMPTY_DOC}
            tocHeadings={tocHeadings}
          />
        )}
      </div>

      {currentUrl && (
        <div className="mt-8 pt-6 border-t border-border">
          <ShareButtons
            title={article.title}
            url={currentUrl}
            excerpt={article.excerpt}
          />
        </div>
      )}
    </article>
  )
}
