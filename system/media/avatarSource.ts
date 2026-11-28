/**
 * Where a person's image may come from. A writer or reader sets their own
 * image address, and the page policy allows image hosts anyone can create;
 * an image from anywhere would tell its host every reader's address and the
 * time of each visit. So an avatar shows only an image this deployment
 * stores (its file storage: the backend's origin, under `/api/storage/`) or
 * a file under one of this site's own image paths (`sitePaths`); anything
 * else draws initials. Never `/_next/` (the image optimiser fetches any
 * address it is given) or `/api/`.
 *
 * The seam: when the article view's `safeImageSrc(value, sources)`
 * (lib/tiptap/sanitizeReadingDoc.ts) and the shared host list
 * (lib/security/imageSources.ts) reach the base, `avatarSrc` calls
 * `safeImageSrc(value, AVATAR_SOURCES)` with that list; callers do not
 * change.
 */

export type AvatarSources = {
  /** This deployment's file storage origin, or null when not configured. */
  storageOrigin: string | null
  /** The storage path every stored file sits under. */
  storagePath: string
  /** This site's own image paths, from public/. */
  sitePaths: readonly string[]
}

function originOf(value: string | undefined): string | null {
  if (!value?.trim()) return null
  try {
    const url = new URL(value.trim())
    return url.protocol === 'https:' || url.protocol === 'http:'
      ? url.origin
      : null
  } catch {
    return null
  }
}

export const AVATAR_SOURCES: AvatarSources = {
  storageOrigin: originOf(process.env.NEXT_PUBLIC_CONVEX_URL),
  storagePath: '/api/storage/',
  sitePaths: ['/images/'],
}

/**
 * The address to draw, or null to draw initials: a file under one of this
 * site's image paths (after `..` and encoded dots are resolved, with no
 * query), or an address in this deployment's storage. Never a data, blob or
 * javascript address; never another host.
 */
export function avatarSrc(
  value: string | null | undefined,
  sources: AvatarSources = AVATAR_SOURCES
): string | null {
  const raw = value?.trim()
  if (!raw || /[\\\s]/.test(raw)) return null
  if (raw.startsWith('/') && !raw.startsWith('//')) {
    // An encoded slash, backslash or nul can reach another path on a
    // server that decodes it.
    if (/%(2f|5c|00)/i.test(raw)) return null
    let path: URL
    try {
      path = new URL(raw, 'https://site.invalid')
    } catch {
      return null
    }
    if (path.origin !== 'https://site.invalid' || path.search) return null
    const pathname = path.pathname
    return sources.sitePaths.some((prefix) => pathname.startsWith(prefix))
      ? pathname
      : null
  }
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return null
  }
  if (
    sources.storageOrigin &&
    url.origin === sources.storageOrigin &&
    url.pathname.startsWith(sources.storagePath) &&
    !url.username &&
    !url.password
  )
    return url.href
  return null
}
