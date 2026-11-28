import type { JSONContent } from '@tiptap/react'
import { ArticleReadOnlyBody } from '@/components/articles/ArticleReadOnlyBody'
import { ArticleReaderHeader } from '@/components/articles/ArticleReaderHeader'
import { EditorialSurface } from '@/components/layout/EditorialSurface'
import { estimateArticleReadingMinutes } from '@/lib/reading-time'
import type { Id } from '@/convex/_generated/dataModel'
import { ArticleTipsPanel } from './ArticleTipsPanel'
import { WritingBrand } from './WritingBrand'

/* Full navigation runs the writing desk unsaved-changes guard. */
/* eslint-disable @next/next/no-html-link-for-pages */
export function PublishedArticleLocked({
  title,
  excerpt,
  topic,
  authorName,
  content,
  articleHref,
  articleId,
  className,
}: {
  title: string
  excerpt?: string
  topic?: string
  authorName?: string
  content: JSONContent | null
  articleHref?: string
  articleId?: Id<'articles'> | null
  className: string
}) {
  return (
    <div className={`writing-workspace ${className}`}>
      <header className="topbar">
        <WritingBrand />
        <div className="actions">
          <a className="locked-desk-link" href="/write?desk=writing">
            Your writing
          </a>
        </div>
      </header>
      <main className="locked-main">
        <section className="locked-notice" aria-labelledby="locked-title">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <rect x="5" y="11" width="14" height="10" rx="2" />
            <path d="M8 11V8a4 4 0 0 1 8 0v3" />
          </svg>
          <div>
            <h1 id="locked-title">
              This article is published and can&rsquo;t be changed.
            </h1>
            <p>
              The permanent copy is saved as it was published, so the Quilltip
              page stays the same. Start a new draft to write something new.
            </p>
            {articleHref && (
              <a className="locked-article-link" href={articleHref}>
                View article <span aria-hidden="true">↗︎</span>
              </a>
            )}
          </div>
        </section>
        {articleId && <ArticleTipsPanel articleId={articleId} />}
        <EditorialSurface className="reader-layout">
          <article
            className="reader-article reader-article-preview"
            aria-label={`${title} (read-only)`}
          >
            <ArticleReaderHeader
              title={title.trim() ? title : 'Untitled'}
              subtitle={excerpt}
              topic={topic}
              author={authorName && <span>{authorName}</span>}
              readingMinutes={estimateArticleReadingMinutes(content)}
            />
            {content && (
              <div className="article-content">
                <ArticleReadOnlyBody content={content} />
              </div>
            )}
          </article>
        </EditorialSurface>
      </main>
    </div>
  )
}
