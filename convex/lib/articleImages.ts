import { ConvexError } from 'convex/values'
import {
  imageSourceRefusal,
  isAllowedImageSource,
} from '../../lib/security/imageSources'

/** Node types that carry an article image. */
const IMAGE_NODE_TYPES = new Set(['image', 'resizableImage'])

type Json = Record<string, unknown>

function isRecord(value: unknown): value is Json {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

/** The `src` of every node of the given types in `content`, in order. */
function nodeSources(content: unknown, types: ReadonlySet<string>): unknown[] {
  const sources: unknown[] = []
  const visit = (node: unknown) => {
    if (!isRecord(node)) return
    if (typeof node.type === 'string' && types.has(node.type)) {
      sources.push(isRecord(node.attrs) ? node.attrs.src : undefined)
    }
    if (Array.isArray(node.content)) node.content.forEach(visit)
  }
  visit(content)
  return sources
}

/** The `src` of every video embed node in `content`, in document order. */
export function articleEmbedSources(content: unknown): unknown[] {
  return nodeSources(content, new Set(['youtube']))
}

/** The `src` of every image node in `content`, in document order. */
export function articleImageSources(content: unknown): unknown[] {
  return nodeSources(content, IMAGE_NODE_TYPES)
}

/**
 * Refuses to publish an article whose cover or body holds an image from
 * outside this deployment's storage and the listed hosts
 * (`lib/security/imageSources.ts`; the deployment's own origin is
 * `CONVEX_CLOUD_URL`, the origin of `ctx.storage.getUrl` addresses). Drafts
 * are never checked: an autosave keeps a writer's work as it is (#615).
 */
export function assertPublishableImages(article: {
  content: unknown
  coverImage?: string
}): void {
  const convexUrl = process.env.CONVEX_CLOUD_URL
  const sources = [
    ...(article.coverImage ? [article.coverImage] : []),
    ...articleImageSources(article.content),
  ]
  for (const src of sources) {
    if (!isAllowedImageSource(src, convexUrl)) {
      throw new ConvexError(imageSourceRefusal(src))
    }
  }
}

/**
 * `article` as readers get it: a cover from another host is left out, so no
 * list or page sends its address (#633). The stored row is unchanged, and
 * the author's own editor reads it as stored.
 */
export function withShownCover<T extends { coverImage?: string }>(
  article: T
): T {
  if (
    !article.coverImage ||
    isAllowedImageSource(article.coverImage, process.env.CONVEX_CLOUD_URL)
  ) {
    return article
  }
  const { coverImage: _outside, ...rest } = article
  return rest as T
}
