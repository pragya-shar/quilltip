import Link from 'next/link'
import Image from 'next/image'
import { FileText } from 'lucide-react'

export interface NftCardProps {
  title: string
  slug?: string
  authorUsername?: string
  coverImage?: string
  excerpt?: string
  tokenId: string
  footerLabel: string
  footerUsername?: string
  href?: string
}

function buildArticleHref(
  authorUsername: string | undefined,
  slug: string | undefined
): string | undefined {
  if (!authorUsername || !slug) return undefined
  return `/${authorUsername}/${slug}`
}

export function NftCard({
  title,
  slug,
  authorUsername,
  coverImage,
  excerpt,
  tokenId,
  footerLabel,
  footerUsername,
  href,
}: NftCardProps) {
  const articleHref = href ?? buildArticleHref(authorUsername, slug)
  const displayTitle = title || 'Untitled'
  const truncatedTokenId =
    tokenId.length > 8 ? `${tokenId.slice(0, 8)}...` : tokenId

  const media = coverImage ? (
    <div className="relative aspect-video w-full overflow-hidden rounded-lg">
      <Image
        src={coverImage}
        alt={displayTitle}
        fill
        sizes="(max-width: 768px) 100vw, (max-width: 1024px) 50vw, 33vw"
        className="object-cover"
      />
    </div>
  ) : (
    <div
      className="aspect-video w-full rounded-lg border border-border bg-muted flex flex-col items-center justify-center gap-2 px-4"
      aria-hidden
    >
      <FileText className="h-10 w-10 text-muted-foreground/60" />
      <span className="sr-only">No cover image</span>
    </div>
  )

  const cardBody = (
    <>
      {articleHref ? (
        <Link
          href={articleHref}
          className="focus-ring block rounded-lg"
          scroll={false}
        >
          {media}
        </Link>
      ) : (
        media
      )}

      <div className="mt-4 min-w-0 space-y-1">
        {articleHref ? (
          <Link
            href={articleHref}
            className="focus-ring block rounded-md"
            scroll={false}
          >
            <h4 className="font-semibold text-foreground truncate hover:text-brand-blue transition-colors">
              {displayTitle}
            </h4>
          </Link>
        ) : (
          <h4 className="font-semibold text-foreground truncate">
            {displayTitle}
          </h4>
        )}

        {authorUsername && (
          <p className="text-sm text-muted-foreground truncate">
            @{authorUsername}
          </p>
        )}

        {excerpt && (
          <p className="text-sm text-muted-foreground line-clamp-2">{excerpt}</p>
        )}

        <p className="text-sm text-muted-foreground pt-1">
          Token ID: {truncatedTokenId}
        </p>

        <p className="text-xs text-muted-foreground/80">
          {footerLabel} @{footerUsername || 'unknown'}
        </p>
      </div>
    </>
  )

  return (
    <article className="bg-card rounded-lg shadow-[var(--card-shadow)] border border-border p-3 sm:p-4 min-w-0">
      {cardBody}
    </article>
  )
}
