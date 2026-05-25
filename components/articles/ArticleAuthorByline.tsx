import Link from 'next/link'
import { UserAvatar } from '@/components/ui/user-avatar'
import type { ArticleForDisplay } from '@/types/index'
import { cn } from '@/lib/utils'

export type ArticleAuthorBylineAuthor = ArticleForDisplay['author']

export function canLinkAuthorProfile(author: {
  id: string
  username: string
}): boolean {
  const u = author.username?.trim()
  return Boolean(author.id && u && u !== 'unknown')
}

function profileAriaLabel(displayName: string): string {
  return `View ${displayName}'s profile`
}

type ArticleAuthorBylineProps = {
  author: ArticleAuthorBylineAuthor
  size?: 'sm' | 'md'
  showHandle?: boolean
  className?: string
  children?: React.ReactNode
}

export function ArticleAuthorByline({
  author,
  size = 'md',
  showHandle = false,
  className,
  children,
}: ArticleAuthorBylineProps) {
  const displayName = author.name || author.username
  const linkable = canLinkAuthorProfile(author)
  const avatarClassName = size === 'sm' ? 'h-9 w-9' : 'h-12 w-12'
  const fallbackClassName = size === 'sm' ? undefined : 'text-base'
  const nameClassName =
    size === 'sm'
      ? 'text-sm font-medium text-foreground'
      : 'font-medium text-foreground'
  const handleClassName =
    size === 'sm'
      ? 'text-xs text-muted-foreground'
      : 'text-sm text-muted-foreground'

  const identityBlock = (
    <>
      <UserAvatar
        src={author.avatar}
        alt={displayName}
        name={displayName}
        className={avatarClassName}
        fallbackClassName={fallbackClassName}
      />
      <div>
        <p className={nameClassName}>{displayName}</p>
        {showHandle && <p className={handleClassName}>@{author.username}</p>}
        {!linkable && (
          <p className="text-xs text-muted-foreground">
            Author profile unavailable
          </p>
        )}
      </div>
    </>
  )

  const wrapperClassName = cn('flex flex-col gap-1', className)

  if (linkable) {
    return (
      <div className={wrapperClassName}>
        <Link
          href={`/${author.username}`}
          aria-label={profileAriaLabel(displayName)}
          className="focus-ring flex items-center gap-3 rounded-md hover:opacity-80 transition-opacity w-fit"
        >
          {identityBlock}
        </Link>
        {children}
      </div>
    )
  }

  return (
    <div className={wrapperClassName} aria-label={`Author: ${displayName}`}>
      <div className="flex items-center gap-3">{identityBlock}</div>
      {children}
    </div>
  )
}
