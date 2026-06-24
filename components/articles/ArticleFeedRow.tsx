import Link from 'next/link'
import { ArticleForDisplay } from '@/types/index'
import { canLinkAuthorProfile } from '@/components/articles/ArticleAuthorByline'
import { ArticleListingThumbnail } from '@/components/articles/ArticleListingThumbnail'
import { TagFilterLink } from '@/components/articles/TagFilterLink'
import { UserAvatar } from '@/components/ui/user-avatar'
import {
  formatListingPublishedDate,
  formatListingReadTime,
  formatListingTipCount,
  getListingPublishedDateTime,
  LISTING_FEED_TAG_LIMIT,
} from '@/lib/articles/articleListingMeta'
import { getFeedRowContextLabel } from '@/lib/articles/feedRowStatus'
import type { BrowseView } from '@/lib/articles/browseDiscovery'
import { cn } from '@/lib/utils'

interface ArticleFeedRowProps {
  article: ArticleForDisplay
  priority?: boolean
  onArticleNavigate?: () => void
  tagLinkAuthor?: string
  view?: BrowseView
  isHero?: boolean
}

function MetadataSeparator() {
  return (
    <span className="text-muted-foreground/70" aria-hidden>
      ·
    </span>
  )
}

export default function ArticleFeedRow({
  article,
  priority,
  onArticleNavigate,
  tagLinkAuthor,
  view = 'latest',
  isHero = false,
}: ArticleFeedRowProps) {
  const articleHref = `/${article.author.username}/${article.slug}`
  const contextLabel = getFeedRowContextLabel(view, article)
  const displayName = article.author.name || article.author.username
  const linkableAuthor = canLinkAuthorProfile(article.author)
  const visibleTags = article.tags.slice(0, LISTING_FEED_TAG_LIMIT)
  const handle = article.author.username
  const readTimeLabel = formatListingReadTime(article.readTime)
  const publishedLabel = formatListingPublishedDate(article.publishedAt)
  const tipLabel = formatListingTipCount(article.tipCount)
  const publishedDateTime = getListingPublishedDateTime(article.publishedAt)

  const navigate = () => onArticleNavigate?.()

  return (
    <article
      className={cn(
        'py-6 first:pt-6 last:pb-6',
        isHero && 'border-l-2 border-brand-blue pl-4'
      )}
    >
      <div className="mb-3 flex min-w-0 items-center gap-2 text-[13px] leading-none text-muted-foreground">
        <UserAvatar
          src={article.author.avatar}
          alt={displayName}
          name={displayName}
          className="h-5 w-5 shrink-0"
        />
        <div className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1">
          {linkableAuthor ? (
            <Link
              href={`/${article.author.username}`}
              className="focus-ring truncate rounded-sm font-medium text-foreground hover:underline"
            >
              {displayName}
            </Link>
          ) : (
            <span className="truncate font-medium text-foreground">
              {displayName}
            </span>
          )}
          {handle && handle !== 'unknown' && (
            <>
              <MetadataSeparator />
              <span className="truncate">@{handle}</span>
            </>
          )}
          {readTimeLabel && (
            <>
              <MetadataSeparator />
              <span>{readTimeLabel}</span>
            </>
          )}
          {publishedLabel && (
            <>
              <MetadataSeparator />
              <time dateTime={publishedDateTime}>{publishedLabel}</time>
            </>
          )}
          {tipLabel && (
            <>
              <MetadataSeparator />
              <span>{tipLabel}</span>
            </>
          )}
        </div>
      </div>

      <div className="flex items-start gap-4 sm:gap-6">
        <div className="min-w-0 flex-1">
          <Link
            href={articleHref}
            scroll={false}
            className="focus-ring rounded-md"
            onPointerDown={navigate}
            onClick={navigate}
          >
            <h2
              className={cn(
                'font-bold leading-snug text-foreground line-clamp-3 hover:text-brand-blue transition-colors',
                isHero
                  ? 'text-2xl sm:text-3xl sm:leading-tight'
                  : 'text-xl sm:text-2xl sm:leading-tight'
              )}
            >
              {article.title}
            </h2>
          </Link>

          {article.excerpt && (
            <p className="mt-2 line-clamp-2 text-sm leading-relaxed text-muted-foreground sm:text-base">
              {article.excerpt}
            </p>
          )}
        </div>

        <ArticleListingThumbnail
          title={article.title}
          coverImage={article.coverImage}
          href={articleHref}
          variant="feed"
          priority={priority}
          onNavigate={navigate}
        />
      </div>

      {(visibleTags.length > 0 || contextLabel) && (
        <div className="mt-4 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2 text-[13px] text-muted-foreground">
          {visibleTags.map((tag) => (
            <TagFilterLink
              key={tag.id}
              tag={tag.name}
              author={tagLinkAuthor}
              className="px-3 py-1.5 text-[13px] bg-muted/80"
            >
              {tag.name}
            </TagFilterLink>
          ))}
          {contextLabel && <span>{contextLabel}</span>}
        </div>
      )}
    </article>
  )
}
