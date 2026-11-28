'use client'

/* Covers go through the Next.js image optimizer (getImageProps): sized
   AVIF/WebP for the rendered width, from the author's host or local art. */
import { useState } from 'react'
import Link from 'next/link'
import { ARTICLE_LINK_PREFETCH } from '@/lib/articles/linkPrefetch'
import { getImageProps } from 'next/image'
import { BookmarkButton } from '@/components/library/BookmarkButton'
import { articleHref } from '@/lib/library/bookmarks'
import { buildArticlesBrowseHref } from '@/lib/articles/buildArticlesBrowseHref'
import { articleCategoryLabel } from '@/lib/articles/browseDiscovery'
import type { ArticleForDisplay } from '@/types/index'
import { formatListingReadTime } from '@/lib/articles/articleListingMeta'
import { shownCoverImage } from '@/lib/tiptap/articleImage'
import { ArticleCoverDoodles } from './ArticleCoverDoodles'

const artwork = ['words', 'window', 'room', 'recipe']

/** Rendered cover widths: one column to 600px, two to 950px, then three. */
const COVER_SIZES = '(max-width: 600px) 90vw, (max-width: 950px) 45vw, 440px'

export function ReadingRoomCard({
  article,
  index,
  onNavigate,
  onAuthor,
  tagLinkAuthor,
}: {
  article: ArticleForDisplay
  index: number
  onNavigate: () => void
  onAuthor: (username: string) => void
  tagLinkAuthor?: string
}) {
  const [failedImage, setFailedImage] = useState<string | null>(null)
  const [loadedImage, setLoadedImage] = useState<string | null>(null)
  const fallback = `/prototype/articles/${artwork[index % artwork.length]}-museum.jpg`
  // A cover from another host counts as none (#615).
  const coverImage = shownCoverImage(article.coverImage)
  const image = coverImage && failedImage !== coverImage ? coverImage : fallback
  // The first row is on screen at load: it shows at once (no load reveal), so
  // the largest paint does not wait for the page script.
  const firstRow = index < 3
  const { props: cover } = getImageProps({
    src: image,
    alt: '',
    width: 600,
    height: 400,
    sizes: COVER_SIZES,
    // Only the first cover is certain to be on screen at every width.
    loading: index === 0 ? 'eager' : 'lazy',
    fetchPriority: index === 0 ? 'high' : undefined,
  })
  const shown = firstRow || loadedImage === image
  const href = articleHref({
    username: article.author.username,
    slug: article.slug,
  })
  const name = article.author.name || article.author.username
  const bookmark = {
    id: article.id,
    title: article.title,
    author: name,
    username: article.author.username,
    slug: article.slug,
    topic: articleCategoryLabel(article.tags.map((tag) => tag.name)),
    minutes: article.readTime || 0,
  }
  return (
    <article className="reading-room-card">
      <Link
        prefetch={ARTICLE_LINK_PREFETCH}
        className="cover"
        href={href}
        aria-label={`Read ${article.title}`}
        onClick={onNavigate}
      >
        {/* Hover and load reveal are CSS transitions (reading-room.css). */}
        {/* eslint-disable-next-line @next/next/no-img-element -- optimized via getImageProps */}
        <img
          // An image can finish before hydration, when onLoad has already fired.
          ref={(node) => {
            if (node?.complete && node.naturalWidth > 0) setLoadedImage(image)
          }}
          src={cover.src}
          srcSet={cover.srcSet}
          sizes={cover.sizes}
          width={cover.width}
          height={cover.height}
          loading={cover.loading}
          decoding={cover.decoding}
          fetchPriority={cover.fetchPriority}
          alt=""
          data-loaded={loadedImage === image}
          data-shown={shown}
          onLoad={() => setLoadedImage(image)}
          onError={() => setFailedImage(image)}
        />
        <ArticleCoverDoodles article={article} />
      </Link>
      <div className="details">
        {tagLinkAuthor && article.tags.length > 0 ? (
          <div className="profile-article-tags">
            {article.tags.map((tag) => (
              <Link
                key={tag.id}
                className="category"
                href={buildArticlesBrowseHref({
                  tag: tag.name,
                  author: tagLinkAuthor,
                  page: 1,
                })}
                aria-label={`Filter by tag ${tag.name}`}
              >
                {tag.name}
              </Link>
            ))}
          </div>
        ) : (
          <span className="category">{bookmark.topic}</span>
        )}
        <h2>
          <Link
            prefetch={ARTICLE_LINK_PREFETCH}
            href={href}
            onClick={onNavigate}
          >
            {article.title}
          </Link>
        </h2>
        {article.excerpt && <p className="description">{article.excerpt}</p>}
        <p className="meta">
          <button
            onClick={() => onAuthor(article.author.username)}
            aria-label={`Articles by ${name}`}
          >
            {name}
          </button>
          {formatListingReadTime(article.readTime) && (
            <span> · {formatListingReadTime(article.readTime)}</span>
          )}
        </p>
        <Link
          prefetch={ARTICLE_LINK_PREFETCH}
          className="read-more"
          href={href}
          onClick={onNavigate}
        >
          Read more <span aria-hidden="true">↗︎</span>
        </Link>
      </div>
      <BookmarkButton article={bookmark} resumeIntent={false} />
    </article>
  )
}
