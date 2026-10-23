'use client'

/* Author cover URLs retain their original host; fallback art is local. */
import { useState } from 'react'
import { motion, useReducedMotion } from 'motion/react'
import Link from 'next/link'
import { BookmarkButton } from '@/components/library/BookmarkButton'
import { articleHref } from '@/lib/library/bookmarks'
import type { ArticleForDisplay } from '@/types/index'
import { formatListingReadTime } from '@/lib/articles/articleListingMeta'
import { ArticleCoverDoodles } from './ArticleCoverDoodles'

const artwork = ['words', 'window', 'room', 'recipe']

export function ReadingRoomCard({
  article,
  index,
  onNavigate,
  onAuthor,
}: {
  article: ArticleForDisplay
  index: number
  onNavigate: () => void
  onAuthor: (username: string) => void
}) {
  const [failedImage, setFailedImage] = useState<string | null>(null)
  const [loadedImage, setLoadedImage] = useState<string | null>(null)
  const [hovered, setHovered] = useState(false)
  const reduceMotion = useReducedMotion()
  const fallback = `/prototype/articles/${artwork[index % artwork.length]}-museum.jpg`
  const image =
    article.coverImage && failedImage !== article.coverImage
      ? article.coverImage
      : fallback
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
    topic: article.tags[0]?.name || 'Writing',
    minutes: article.readTime || 0,
  }
  return (
    <article className="reading-room-card">
      <Link
        className="cover"
        href={href}
        aria-label={`Read ${article.title}`}
        onClick={onNavigate}
        onPointerEnter={(event) => {
          if (
            event.pointerType === 'mouse' &&
            window.matchMedia('(hover: hover) and (pointer: fine)').matches
          ) {
            setHovered(true)
          }
        }}
        onPointerLeave={() => setHovered(false)}
      >
        <motion.img
          src={image}
          alt=""
          width={600}
          height={400}
          loading={index < 3 ? 'eager' : 'lazy'}
          data-loaded={loadedImage === image}
          initial={false}
          animate={{
            opacity: loadedImage === image ? 1 : 0,
            transform: reduceMotion
              ? 'scale(1) rotate(0deg)'
              : loadedImage !== image
                ? 'scale(1.1) rotate(-3deg)'
                : hovered
                  ? 'scale(1.07) rotate(1.5deg)'
                  : 'scale(1) rotate(0deg)',
          }}
          transition={
            reduceMotion
              ? { duration: 0.125 }
              : { type: 'spring', duration: 0.5, bounce: 0.2 }
          }
          onLoad={() => setLoadedImage(image)}
          onError={() => setFailedImage(image)}
        />
        <ArticleCoverDoodles article={article} />
      </Link>
      <div className="details">
        <span className="category">{bookmark.topic}</span>
        <h2>
          <Link href={href} onClick={onNavigate}>
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
        <Link className="read-more" href={href} onClick={onNavigate}>
          Read article <span>↗</span>
        </Link>
      </div>
      <BookmarkButton article={bookmark} resumeIntent={false} />
    </article>
  )
}
