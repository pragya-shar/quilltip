import Link from 'next/link'
import Image from 'next/image'
import { formatDistanceToNow } from 'date-fns'
import { ArticleForDisplay } from '@/types/index'
import { ArticleAuthorByline } from '@/components/articles/ArticleAuthorByline'
import { TagFilterLink } from '@/components/articles/TagFilterLink'
import type { BrowseView } from '@/lib/articles/browseDiscovery'

interface ArticleCardProps {
  article: ArticleForDisplay
  priority?: boolean
  onArticleNavigate?: () => void
  tagLinkAuthor?: string
  view?: BrowseView
}

function formatReadTime(minutes?: number): string | null {
  if (!minutes || minutes < 1) return null
  return `${minutes} min read`
}

export default function ArticleCard({
  article,
  priority,
  onArticleNavigate,
  tagLinkAuthor,
  view = 'latest',
}: ArticleCardProps) {
  const publishedDate = article.publishedAt
    ? formatDistanceToNow(new Date(article.publishedAt), { addSuffix: true })
    : null
  const readTimeLabel = formatReadTime(article.readTime)
  const tipCount = article.tipCount ?? 0

  const metaParts = [
    readTimeLabel,
    publishedDate,
    view === 'featured' && tipCount > 0
      ? `${tipCount} tip${tipCount === 1 ? '' : 's'}`
      : null,
  ].filter((part): part is string => Boolean(part))

  return (
    <article className="bg-card rounded-[var(--card-radius)] shadow-[var(--card-shadow)] border border-border ring-1 ring-border/60 hover:shadow-md transition-shadow duration-200 flex flex-col h-full">
      {article.coverImage && (
        <Link
          href={`/${article.author.username}/${article.slug}`}
          scroll={false}
          className="focus-ring block rounded-t-[var(--card-radius)]"
          onPointerDown={() => onArticleNavigate?.()}
          onClick={() => onArticleNavigate?.()}
        >
          <div className="relative h-48 w-full overflow-hidden rounded-t-[var(--card-radius)]">
            <Image
              src={article.coverImage}
              alt={article.title}
              fill
              sizes="(max-width: 768px) 100vw, (max-width: 1024px) 50vw, 33vw"
              priority={priority}
              className="object-cover hover:scale-105 transition-transform duration-200"
            />
          </div>
        </Link>
      )}

      <div className="p-[var(--card-padding)] flex flex-col flex-1">
        <Link
          href={`/${article.author.username}/${article.slug}`}
          scroll={false}
          className="focus-ring rounded-md"
          onPointerDown={() => onArticleNavigate?.()}
          onClick={() => onArticleNavigate?.()}
        >
          <h2 className="text-xl font-bold text-foreground mb-2 hover:text-brand-blue transition-colors line-clamp-2">
            {article.title}
          </h2>
        </Link>

        {article.excerpt && (
          <p className="text-muted-foreground mb-4 line-clamp-3 flex-1">
            {article.excerpt}
          </p>
        )}

        {article.tags.length > 0 && (
          <div className="flex flex-wrap gap-2 mb-4 min-h-[28px]">
            {article.tags.slice(0, 3).map((tag) => (
              <TagFilterLink key={tag.id} tag={tag.name} author={tagLinkAuthor}>
                {tag.name}
              </TagFilterLink>
            ))}
            {article.tags.length > 3 && (
              <span className="text-xs px-2 py-1 text-muted-foreground">
                +{article.tags.length - 3} more
              </span>
            )}
          </div>
        )}

        <div className="flex items-end justify-between gap-3 pt-4 border-t border-border mt-auto">
          <ArticleAuthorByline author={article.author} size="sm" showHandle />

          {metaParts.length > 0 && (
            <p className="text-xs text-muted-foreground text-right shrink-0">
              {metaParts.join(' · ')}
            </p>
          )}
        </div>
      </div>
    </article>
  )
}
