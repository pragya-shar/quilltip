/**
 * Where a person's image may come from. A writer or reader sets their own
 * image address, and the page policy allows image hosts anyone can create;
 * an image from anywhere would tell its host every reader's address and the
 * time of each visit. So an avatar shows only an image this deployment
 * stores (its file storage: the backend's origin, under `/api/storage/`) or
 * a same-site path; anything else draws initials.
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
}

/**
 * The address to draw, or null to draw initials: a same-site path (one
 * leading slash, no backslash), or an address in this deployment's storage.
 * Never a data, blob or javascript address; never another host.
 */
export function avatarSrc(
  value: string | null | undefined,
  sources: AvatarSources = AVATAR_SOURCES
): string | null {
  const raw = value?.trim()
  if (!raw || /[\\\s]/.test(raw)) return null
  if (raw.startsWith('/') && !raw.startsWith('//')) return raw
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
