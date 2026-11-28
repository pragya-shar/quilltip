import { isAllowedImageSource } from '@/lib/security/imageSources'

/**
 * Whether an article image renders: an address on this deployment's own
 * origin or a listed host (`lib/security/imageSources.ts`). Reads
 * `NEXT_PUBLIC_CONVEX_URL`, inlined at build, on the server and in the
 * browser alike, so the server HTML and the reader agree.
 */
export function isArticleImageShown(src: unknown): boolean {
  return isAllowedImageSource(src, process.env.NEXT_PUBLIC_CONVEX_URL)
}

/**
 * A cover readers may see, or undefined: a cover from another host counts as
 * no cover, so a card shows what it shows for an article without one.
 */
export function shownCoverImage(
  cover: string | null | undefined
): string | undefined {
  return cover && isArticleImageShown(cover) ? cover : undefined
}

/**
 * A profile photo readers may see, or undefined: one from another host counts
 * as none, so the avatar shows its initials (#633).
 */
export function shownAvatar(
  src: string | null | undefined
): string | undefined {
  const trimmed = src?.trim()
  return trimmed && isArticleImageShown(trimmed) ? trimmed : undefined
}

/**
 * What a reader gets for an image that does not render: an empty, hidden
 * block, so nothing takes space and the server HTML and the reader match.
 */
export const HIDDEN_ARTICLE_IMAGE = [
  'div',
  { 'data-article-image-hidden': '', hidden: 'hidden' },
] as const
