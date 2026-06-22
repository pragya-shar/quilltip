import Link from 'next/link'
import Image from 'next/image'
import { format } from 'date-fns'
import { Bookmark, MoreHorizontal } from 'lucide-react'
import { ArticleForDisplay } from '@/types/index'
import { canLinkAuthorProfile } from '@/components/articles/ArticleAuthorByline'
import { TagFilterLink } from '@/components/articles/TagFilterLink'
import { UserAvatar } from '@/components/ui/user-avatar'
import { Button } from '@/components/ui/button'
import {
  formatReadTime,
  getFeedRowContextLabel,
} from '@/lib/articles/feedRowStatus'
import type { BrowseView } from '@/lib/articles/browseDiscovery'
import { cn } from '@/lib/utils'

interface ArticleFeedRowProps {
  article: ArticleForDisplay
  priority?: boolean
  onArticleNavigate?: () => void
  tagLinkAuthor?: string
  view?: BrowseView
}

function formatPublishedDate(publishedAt: Date | string | null): string | null {
  if (!publishedAt) return null
  const date = publishedAt instanceof Date ? publishedAt : new Date(publishedAt)
  if (Number.isNaN(date.getTime())) return null
  return format(date, 'MMM d')
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
}: ArticleFeedRowProps) {
  const articleHref = `/${article.author.username}/${article.slug}`
  const publishedLabel = formatPublishedDate(article.publishedAt)
  const readTimeLabel = formatReadTime(article.readTime)
  const contextLabel = getFeedRowContextLabel(view, article)
  const displayName = article.author.name || article.author.username
  const linkableAuthor = canLinkAuthorProfile(article.author)
  const primaryTag = article.tags[0]
  const handle = article.author.username

  const navigate = () => onArticleNavigate?.()

  const publishedDateTime =
    article.publishedAt instanceof Date
      ? article.publishedAt.toISOString()
      : (article.publishedAt ?? undefined)

  return (
    <article className="py-8 first:pt-6 last:pb-6">
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
          {publishedLabel && (
            <>
              <MetadataSeparator />
              <time dateTime={publishedDateTime}>{publishedLabel}</time>
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
            <h2 className="text-xl font-bold leading-snug text-foreground line-clamp-3 sm:text-2xl sm:leading-tight hover:text-brand-blue transition-colors">
              {article.title}
            </h2>
          </Link>

          {article.excerpt && (
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground line-clamp-2 sm:text-base">
              {article.excerpt}
            </p>
          )}
        </div>

        {article.coverImage && (
          <Link
            href={articleHref}
            scroll={false}
            className={cn(
              'focus-ring relative shrink-0 overflow-hidden bg-muted',
              'h-[72px] w-[72px] rounded-sm sm:h-[112px] sm:w-[112px]'
            )}
            onPointerDown={navigate}
            onClick={navigate}
          >
            <Image
              src={article.coverImage}
              alt={article.title}
              fill
              sizes="(max-width: 640px) 72px, 112px"
              priority={priority}
              className="object-cover"
            />
          </Link>
        )}
      </div>

      <div className="mt-4 flex items-center justify-between gap-4">
        <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2 text-[13px] text-muted-foreground">
          {primaryTag && (
            <TagFilterLink
              tag={primaryTag.name}
              author={tagLinkAuthor}
              className="px-3 py-1.5 text-[13px] bg-muted/80"
            >
              {primaryTag.name}
            </TagFilterLink>
          )}
          {readTimeLabel && <span>{readTimeLabel}</span>}
          {contextLabel && <span>{contextLabel}</span>}
        </div>

        <div className="flex shrink-0 items-center gap-0.5 text-muted-foreground">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-9 w-9 rounded-full text-muted-foreground hover:text-foreground"
            aria-label={`Save ${article.title}`}
          >
            <Bookmark className="h-5 w-5" aria-hidden />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-9 w-9 rounded-full text-muted-foreground hover:text-foreground"
            aria-label={`More options for ${article.title}`}
          >
            <MoreHorizontal className="h-5 w-5" aria-hidden />
          </Button>
        </div>
      </div>
    </article>
  )
}
