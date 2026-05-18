import Image from 'next/image'
import Link from 'next/link'
import { UserAvatar } from '@/components/ui/user-avatar'
import type { ArticleForDisplay } from '@/types/index'

interface LandingProofArticleCardProps {
  article: ArticleForDisplay
  priority?: boolean
}

export function LandingProofArticleCard({
  article,
  priority,
}: LandingProofArticleCardProps) {
  const authorName = article.author.name || article.author.username
  const href = `/${article.author.username}/${article.slug}`

  return (
    <Link
      href={href}
      className="focus-ring flex items-center gap-3 rounded-lg border border-border bg-card p-3 text-left shadow-[var(--card-shadow)] transition-shadow hover:shadow-md"
    >
      {article.coverImage ? (
        <div className="relative h-12 w-12 shrink-0 overflow-hidden rounded-md">
          <Image
            src={article.coverImage}
            alt=""
            fill
            sizes="48px"
            priority={priority}
            className="object-cover"
          />
        </div>
      ) : (
        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-md bg-muted text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          {article.title.slice(0, 2)}
        </div>
      )}

      <div className="min-w-0 flex-1">
        <p className="line-clamp-1 text-[13px] font-semibold text-foreground">
          {article.title}
        </p>
        {article.excerpt ? (
          <p className="mt-0.5 line-clamp-1 text-[12px] text-muted-foreground">
            {article.excerpt}
          </p>
        ) : null}
        <div className="mt-1.5 flex items-center gap-1.5">
          <UserAvatar
            src={article.author.avatar}
            alt={authorName}
            name={authorName}
            className="h-4 w-4"
          />
          <span className="truncate text-[11px] text-muted-foreground">
            @{article.author.username}
          </span>
        </div>
      </div>
    </Link>
  )
}
