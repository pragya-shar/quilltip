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

/** The `src` of every image node in `content`, in document order. */
export function articleImageSources(content: unknown): unknown[] {
  const sources: unknown[] = []
  const visit = (node: unknown) => {
    if (!isRecord(node)) return
    if (typeof node.type === 'string' && IMAGE_NODE_TYPES.has(node.type)) {
      sources.push(isRecord(node.attrs) ? node.attrs.src : undefined)
    }
    if (Array.isArray(node.content)) node.content.forEach(visit)
  }
  visit(content)
  return sources
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
