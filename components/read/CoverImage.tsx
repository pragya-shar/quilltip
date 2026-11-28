/* eslint-disable no-restricted-syntax, @next/next/no-img-element -- the article's cover, under the reading image rule below; next/image adds a proxy route the rule would have to cover too */
import {
  deploymentSources,
  safeImageSrc,
} from '@/lib/tiptap/sanitizeReadingDoc'

/**
 * An article's cover. The address is the writer's, so it is drawn only
 * under the reading image rule (`safeImageSrc`: this deployment's storage
 * or the site's own image paths, no query); anything else draws nothing.
 * Eager, because it can be the largest paint, and it sends no referrer.
 */
export function CoverImage({ src }: { src: string | null }) {
  const image = safeImageSrc(src, deploymentSources())
  if (!image) return null
  return (
    <figure className="qt-read__cover">
      <img
        src={image}
        alt=""
        fetchPriority="high"
        // The image host learns nothing about the page it is shown on.
        referrerPolicy="no-referrer"
      />
    </figure>
  )
}
