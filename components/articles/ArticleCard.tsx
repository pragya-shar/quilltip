import Link from 'next/link'
import { ArticleForDisplay } from '@/types/index'
import { ArticleAuthorByline } from '@/components/articles/ArticleAuthorByline'
import { ArticleListingThumbnail } from '@/components/articles/ArticleListingThumbnail'
import { TagFilterLink } from '@/components/articles/TagFilterLink'
import {
  formatListingPublishedDate,
  formatListingReadTime,
  formatListingTipCount,
  getListingPublishedDateTime,
  LISTING_CARD_TAG_LIMIT,
} from '@/lib/articles/articleListingMeta'
import type { BrowseView } from '@/lib/articles/browseDiscovery'

interface ArticleCardProps {
  article: ArticleForDisplay
  priority?: boolean
  onArticleNavigate?: () => void
  tagLinkAuthor?: string
  view?: BrowseView
}

export default function ArticleCard({
  article,
  priority,
  onArticleNavigate,
  tagLinkAuthor,
}: ArticleCardProps) {
  const articleHref = `/${article.author.username}/${article.slug}`
  const readTimeLabel = formatListingReadTime(article.readTime)
  const publishedLabel = formatListingPublishedDate(article.publishedAt)
  const tipLabel = formatListingTipCount(article.tipCount)
  const publishedDateTime = getListingPublishedDateTime(article.publishedAt)
  const navigate = () => onArticleNavigate?.()

  return (
    <article className="bg-card rounded-[var(--card-radius)] shadow-[var(--card-shadow)] border border-border ring-1 ring-border/60 hover:shadow-md transition-shadow duration-200 flex flex-col h-full">
      <ArticleListingThumbnail
        title={article.title}
        coverImage={article.coverImage}
        href={articleHref}
        variant="card"
        priority={priority}
        onNavigate={navigate}
      />

      <div className="p-[var(--card-padding)] flex flex-col flex-1">
        <Link
          href={articleHref}
          scroll={false}
          className="focus-ring rounded-md"
          onPointerDown={navigate}
          onClick={navigate}
        >
          <h2 className="text-xl font-bold text-foreground mb-2 hover:text-brand-blue transition-colors line-clamp-2">
            {article.title}
          </h2>
        </Link>

        {article.excerpt && (
          <p className="text-muted-foreground mb-4 line-clamp-2 flex-1">
            {article.excerpt}
          </p>
        )}

        {article.tags.length > 0 && (
          <div className="flex flex-wrap gap-2 mb-4 min-h-[28px]">
            {article.tags.slice(0, LISTING_CARD_TAG_LIMIT).map((tag) => (
              <TagFilterLink
                key={tag.id}
                tag={tag.name}
                author={tagLinkAuthor}
                className="px-3 py-1.5 text-[13px] bg-muted/80"
              >
                {tag.name}
              </TagFilterLink>
            ))}
            {article.tags.length > LISTING_CARD_TAG_LIMIT && (
              <span className="text-xs px-2 py-1 text-muted-foreground">
                +{article.tags.length - LISTING_CARD_TAG_LIMIT} more
              </span>
            )}
          </div>
        )}

        <div className="flex items-end justify-between gap-3 pt-4 border-t border-border mt-auto">
          <ArticleAuthorByline author={article.author} size="sm" showHandle />

          {(readTimeLabel || publishedLabel || tipLabel) && (
            <p className="text-xs text-muted-foreground text-right shrink-0">
              {readTimeLabel}
              {readTimeLabel && publishedLabel && ' · '}
              {publishedLabel && (
                <time dateTime={publishedDateTime}>{publishedLabel}</time>
              )}
              {(readTimeLabel || publishedLabel) && tipLabel && ' · '}
              {tipLabel}
            </p>
          )}
        </div>
      </div>
    </article>
  )
}
