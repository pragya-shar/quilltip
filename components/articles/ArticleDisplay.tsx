'use client'

import { useEditor, EditorContent, type JSONContent } from '@tiptap/react'
import { useEffect, useState } from 'react'
import StarterKit from '@tiptap/starter-kit'
import Underline from '@tiptap/extension-underline'
import Link from '@tiptap/extension-link'
import CodeBlockLowlight from '@tiptap/extension-code-block-lowlight'
import { lowlight } from '@/lib/lowlight'
import { ResizableImage } from '@/components/editor/extensions/ResizableImage'
import { formatDistanceToNow } from 'date-fns'
import Image from 'next/image'
import { UserAvatar } from '@/components/ui/user-avatar'
import ShareButtons from './ShareButtons'
import { HighlightableArticle } from '@/components/articles/HighlightableArticle'
import { useAuth } from '@/components/providers/AuthContext'
import type { Id } from '@/types/convex'
import type { ArticleForDisplay } from '@/types/index'
import { EDITOR_PROSE_CLASS } from '@/lib/constants'
import { TagFilterLink } from '@/components/articles/TagFilterLink'
import { extractPlainTextFromTiptapJson } from '@/lib/tiptap/plainText'
import { estimateReadingMinutes } from '@/lib/reading-time'
import type { TocHeading } from '@/lib/tiptap/headings'
import { useEnsureHeadingIds } from '@/components/articles/useEnsureHeadingIds'

const EMPTY_DOC: JSONContent = { type: 'doc', content: [] }

interface ArticleDisplayProps {
  article: ArticleForDisplay
  showHighlights?: boolean
  tocHeadings?: TocHeading[]
}

export default function ArticleDisplay({
  article,
  showHighlights = true,
  tocHeadings = [],
}: ArticleDisplayProps) {
  const [currentUrl, setCurrentUrl] = useState('')
  const { isAuthenticated } = useAuth()
  const [useHighlightable, setUseHighlightable] = useState(false)

  // Get current URL on client side only
  useEffect(() => {
    setCurrentUrl(window.location.href)
    // Enable highlightable article for authenticated users
    setUseHighlightable(showHighlights && isAuthenticated)
  }, [showHighlights, isAuthenticated])

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        // StarterKit v3 ships codeBlock, link, and underline by default; we
        // register customised versions of each below, so disable them here
        // to avoid duplicate-extension warnings.
        codeBlock: false,
        link: false,
        underline: false,
      }),
      Underline,
      Link.configure({
        openOnClick: false,
      }),
      CodeBlockLowlight.configure({
        lowlight,
      }),
      ResizableImage,
    ],
    content: article.content ?? EMPTY_DOC,
    editable: false,
    immediatelyRender: false, // Fix SSR hydration issue
    editorProps: {
      attributes: {
        class: `${EDITOR_PROSE_CLASS} prose-stone`,
      },
    },
  })

  const publishedDate = article.publishedAt
    ? formatDistanceToNow(new Date(article.publishedAt), { addSuffix: true })
    : null

  const readingMinutes = estimateReadingMinutes(
    extractPlainTextFromTiptapJson(article.content)
  )

  useEnsureHeadingIds(tocHeadings, { rootSelector: '.article-content' })

  return (
    <article className="max-w-4xl mx-auto px-4 py-8">
      {/* Article Header */}
      <header className="mb-8">
        <h1 className="text-3xl md:text-4xl font-semibold text-foreground mb-3 leading-snug">
          {article.title}
        </h1>

        {/* Author Info */}
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

        {/* Cover Image */}
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

        {/* Tags */}
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

      {/* Article Content */}
      <div className="article-content">
        {useHighlightable ? (
          <HighlightableArticle
            articleId={article.id as Id<'articles'>}
            content={article.content ?? EMPTY_DOC}
            showHighlights={showHighlights}
            tocHeadings={tocHeadings}
          />
        ) : (
          <EditorContent editor={editor} />
        )}
      </div>

      {/* Share Buttons */}
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
