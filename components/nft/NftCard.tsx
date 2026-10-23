import Link from 'next/link'
import Image from 'next/image'
import { FileText } from 'lucide-react'
import './nft-card.css'

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
  const articleContent = (
    <>
      <div className="nft-card-media">
        {coverImage ? (
          <Image
            src={coverImage}
            alt=""
            fill
            sizes="(max-width: 640px) 100vw, (max-width: 1000px) 50vw, 33vw"
            className="object-cover"
          />
        ) : (
          <div className="nft-card-bookplate" aria-hidden="true">
            <FileText strokeWidth={1} />
            <span>Collected words</span>
          </div>
        )}
        <span className="nft-card-edition">Article NFT</span>
      </div>
      <div className="nft-card-copy">
        <h3 title={displayTitle}>{displayTitle}</h3>
        {authorUsername && <p className="nft-card-author">@{authorUsername}</p>}
        {excerpt && <p className="nft-card-excerpt">{excerpt}</p>}
        {articleHref && (
          <span className="nft-card-read">
            Read more <span aria-hidden="true">↗</span>
          </span>
        )}
      </div>
    </>
  )

  return (
    <article className="nft-card">
      {articleHref ? (
        <Link
          href={articleHref}
          className="nft-card-article"
          scroll={false}
          aria-label={`Read more: ${displayTitle}`}
        >
          {articleContent}
        </Link>
      ) : (
        <div className="nft-card-article">{articleContent}</div>
      )}
      <div className="nft-card-details">
        <p className="nft-card-token">
          Token ID <span>{tokenId}</span>
        </p>
        <p className="nft-card-owner">
          <span>{footerLabel}</span>{' '}
          {footerUsername ? (
            <Link href={`/${footerUsername}`}>@{footerUsername}</Link>
          ) : (
            <span>Unknown</span>
          )}
        </p>
      </div>
    </article>
  )
}
