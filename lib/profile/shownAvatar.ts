// Imported by UserAvatar and the profile page: keep it free of browser, Next
// and Node-only imports, and of the image source list.

/**
 * Whether `src` is an upload in the storage of the deployment at `convexUrl`:
 * its origin (scheme, host and port), under `/api/storage/`, without
 * credentials (#633). The display side of the rule the save applies
 * (`isOwnStorageAddress` in `lib/security/imageSources.ts`); the two are held
 * together by scripts/article-content/avatar-parity.test.ts. Apart from that
 * module so `UserAvatar`, which sits in more than one first-load chunk, does
 * not carry the image source list.
 */
export function isOwnStorageAvatar(
  src: string,
  convexUrl: string | undefined
): boolean {
  try {
    const own = new URL(convexUrl?.trim() ?? '')
    const url = new URL(src)
    return (
      (own.protocol === 'https:' || own.protocol === 'http:') &&
      url.protocol === own.protocol &&
      url.origin === own.origin &&
      url.pathname.startsWith('/api/storage/') &&
      !url.username &&
      !url.password
    )
  } catch {
    return false
  }
}

/**
 * A profile photo readers may see, or undefined: profile photos are uploads,
 * so a photo anywhere else, a listed stock host included, shows the initials
 * (#633). Reads `NEXT_PUBLIC_CONVEX_URL`, inlined at build.
 */
export function shownAvatar(
  src: string | null | undefined
): string | undefined {
  const trimmed = src?.trim()
  return trimmed &&
    isOwnStorageAvatar(trimmed, process.env.NEXT_PUBLIC_CONVEX_URL)
    ? trimmed
    : undefined
}
