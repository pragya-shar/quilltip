// Imported by Convex functions and by the app (and the v3 shell's publish
// check): keep it free of browser, Next and Node-only imports.
/**
 * Where images load from (#615): this deployment's own Convex origin, read
 * from configuration, and the listed hosts. One list for every place that
 * decides, so they cannot drift:
 *
 * - the page image policy, `img-src` (`lib/security/contentSecurityPolicy.ts`,
 *   built per request by `proxy.ts` from `NEXT_PUBLIC_CONVEX_URL`);
 * - the image optimizer's `remotePatterns` (`next.config.ts`, at build, from
 *   `NEXT_PUBLIC_CONVEX_URL`);
 * - the article renderers: server HTML, client body, highlight view and the
 *   writing editor (`NEXT_PUBLIC_CONVEX_URL`, inlined at build);
 * - the publish check in Convex (`convex/articles.ts`, from `CONVEX_CLOUD_URL`).
 *
 * Uploaded images, avatars and covers are addresses from
 * `ctx.storage.getUrl`: `<CONVEX_CLOUD_URL>/api/storage/<id>`, on the same
 * origin as `NEXT_PUBLIC_CONVEX_URL` (`https://<name>.convex.cloud` hosted,
 * `http://127.0.0.1:<port>` for a local backend). No import here, so Convex
 * and the app share this file.
 */

/** A source: scheme, host, port ('' for the default) and a path prefix. */
export type ImageSource = {
  protocol: 'https' | 'http'
  hostname: string
  port: string
  pathPrefix: string
}

/**
 * Hosts listed besides this deployment, each with the feature that needs it.
 */
export const LISTED_IMAGE_SOURCES: readonly ImageSource[] = [
  // Video thumbnails in the older editor's video dialog (YouTubeEmbedDialog),
  // and thumbnail addresses a writer may have used in an article.
  {
    protocol: 'https',
    hostname: 'img.youtube.com',
    port: '',
    pathPrefix: '/vi/',
  },
  // Unsplash images in existing articles and covers; no code adds them.
  {
    protocol: 'https',
    hostname: 'images.unsplash.com',
    port: '',
    pathPrefix: '/',
  },
  {
    protocol: 'https',
    hostname: 'plus.unsplash.com',
    port: '',
    pathPrefix: '/',
  },
  // Images stored on Arweave in existing articles; no code adds them.
  { protocol: 'https', hostname: 'arweave.net', port: '', pathPrefix: '/' },
]

/**
 * The deployment's own file storage as a source: its origin and
 * `/api/storage/`, the path of every `ctx.storage.getUrl` address. Null when
 * unset or malformed.
 */
export function ownImageSource(
  convexUrl: string | undefined
): ImageSource | null {
  if (!convexUrl?.trim()) return null
  try {
    const url = new URL(convexUrl.trim())
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null
    return {
      protocol: url.protocol === 'https:' ? 'https' : 'http',
      hostname: url.hostname,
      port: url.port,
      pathPrefix: '/api/storage/',
    }
  } catch {
    return null
  }
}

/** Every source images may load from, the deployment's own first. */
export function imageSources(convexUrl: string | undefined): ImageSource[] {
  const own = ownImageSource(convexUrl)
  return [...(own ? [own] : []), ...LISTED_IMAGE_SOURCES]
}

/** Whether an image at `src` may load: an absolute address on a source. */
export function isAllowedImageSource(
  src: unknown,
  convexUrl: string | undefined
): boolean {
  if (typeof src !== 'string') return false
  let url: URL
  try {
    url = new URL(src)
  } catch {
    return false
  }
  if (url.username || url.password) return false
  return imageSources(convexUrl).some(
    (source) =>
      url.protocol === `${source.protocol}:` &&
      url.hostname === source.hostname &&
      url.port === source.port &&
      url.pathname.startsWith(source.pathPrefix)
  )
}

function sourceOrigin(source: ImageSource): string {
  return `${source.protocol}://${source.hostname}${source.port ? `:${source.port}` : ''}`
}

/** `img-src` entries for the page policy. */
export function imagePolicySources(convexUrl: string | undefined): string[] {
  return imageSources(convexUrl).map(
    (source) => `${sourceOrigin(source)}${source.pathPrefix}`
  )
}

/** `images.remotePatterns` entries for `next.config.ts`. */
export function imageRemotePatterns(convexUrl: string | undefined) {
  return imageSources(convexUrl).map((source) => ({
    protocol: source.protocol,
    hostname: source.hostname,
    port: source.port,
    pathname: `${source.pathPrefix}**`,
  }))
}

/** The listed hosts, as the editor and the publish check name them. */
export function listedImageHostsText(): string {
  const hosts = LISTED_IMAGE_SOURCES.map((source) => source.hostname)
  return `${hosts.slice(0, -1).join(', ')} or ${hosts[hosts.length - 1]}`
}

/** The refusal for an image from another host, in the editor and on publish. */
export function imageSourceRefusal(src: unknown): string {
  if (typeof src !== 'string' || !src.trim()) {
    return `An image in this article has no address. Remove it, or upload the image. Images must be uploaded, or come from ${listedImageHostsText()}.`
  }
  const shown = src.length > 120 ? `${src.slice(0, 117)}...` : src
  return `This image cannot be used: ${shown}. Images must be uploaded, or come from ${listedImageHostsText()}.`
}

/** The refusal for a profile photo from another host (#633). */
export function avatarSourceRefusal(src: string): string {
  const shown = src.length > 120 ? `${src.slice(0, 117)}...` : src
  return `This photo cannot be used: ${shown}. Profile photos must be uploaded, or come from ${listedImageHostsText()}.`
}
