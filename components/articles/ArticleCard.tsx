import Link from 'next/link'
import Image from 'next/image'
import { formatDistanceToNow } from 'date-fns'
import { ArticleForDisplay } from '@/types/index'
import { ArticleAuthorByline } from '@/components/articles/ArticleAuthorByline'
import { TagFilterLink } from '@/components/articles/TagFilterLink'

interface ArticleCardProps {
  article: ArticleForDisplay
  priority?: boolean
  onArticleNavigate?: () => void
}

export default function ArticleCard({
  article,
  priority,
  onArticleNavigate,
}: ArticleCardProps) {
  const publishedDate = article.publishedAt
    ? formatDistanceToNow(new Date(article.publishedAt), { addSuffix: true })
    : null

  return (
    <article className="bg-card rounded-[var(--card-radius)] shadow-[var(--card-shadow)] border border-border ring-1 ring-border/60 hover:shadow-md transition-shadow duration-200">
      {/* Cover Image */}
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

      <div className="p-[var(--card-padding)]">
        {/* Title */}
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

        {/* Excerpt */}
        {article.excerpt && (
          <p className="text-muted-foreground mb-4 line-clamp-3">
            {article.excerpt}
          </p>
        )}

        {/* Tags */}
        {article.tags.length > 0 && (
          <div className="flex flex-wrap gap-2 mb-4">
            {article.tags.slice(0, 3).map((tag) => (
              <TagFilterLink key={tag.id} tag={tag.name}>
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

        {/* Author Info */}
        <div className="flex items-center justify-between pt-4 border-t border-border">
          <ArticleAuthorByline
            author={article.author}
            size="sm"
            showHandle
          />

          {/* Published Date */}
          {publishedDate && (
            <span className="text-xs text-muted-foreground">
              {publishedDate}
            </span>
          )}
        </div>
      </div>
    </article>
  )
}
