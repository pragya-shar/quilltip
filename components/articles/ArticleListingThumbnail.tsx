import Link from 'next/link'
import Image from 'next/image'
import { getTitleMonogram } from '@/lib/articles/articleListingMeta'
import { cn } from '@/lib/utils'

type ArticleListingThumbnailProps = {
  title: string
  coverImage?: string | null
  href: string
  variant: 'feed' | 'card'
  priority?: boolean
  onNavigate?: () => void
}

export function ArticleListingThumbnail({
  title,
  coverImage,
  href,
  variant,
  priority,
  onNavigate,
}: ArticleListingThumbnailProps) {
  const monogram = getTitleMonogram(title)

  if (variant === 'feed') {
    return (
      <Link
        href={href}
        scroll={false}
        className={cn(
          'focus-ring relative shrink-0 overflow-hidden bg-muted',
          'h-[72px] w-[72px] rounded-sm sm:h-[112px] sm:w-[112px]'
        )}
        onPointerDown={() => onNavigate?.()}
        onClick={() => onNavigate?.()}
      >
        {coverImage ? (
          <Image
            src={coverImage}
            alt={title}
            fill
            sizes="(max-width: 640px) 72px, 112px"
            priority={priority}
            className="object-cover"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-[13px] font-semibold uppercase tracking-wide text-muted-foreground sm:text-base">
            {monogram}
          </div>
        )}
      </Link>
    )
  }

  return (
    <Link
      href={href}
      scroll={false}
      className="focus-ring block rounded-t-[var(--card-radius)]"
      onPointerDown={() => onNavigate?.()}
      onClick={() => onNavigate?.()}
    >
      <div className="relative h-48 w-full overflow-hidden rounded-t-[var(--card-radius)] bg-muted">
        {coverImage ? (
          <Image
            src={coverImage}
            alt={title}
            fill
            sizes="(max-width: 768px) 100vw, (max-width: 1024px) 50vw, 33vw"
            priority={priority}
            className="object-cover hover:scale-105 transition-transform duration-200"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-2xl font-semibold uppercase tracking-wide text-muted-foreground">
            {monogram}
          </div>
        )}
      </div>
    </Link>
  )
}
