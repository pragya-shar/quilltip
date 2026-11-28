// Imported by Convex functions and the writing editor: keep it free of
// browser, Next and Node-only imports.
import { LISTED_IMAGE_SOURCES } from './imageSources'

/*
 * The refusal text for images and profile photos (#615, #633). Apart from
 * `lib/security/imageSources.ts`, so the readers, cards and avatars that
 * check a source do not carry the text.
 */

/** The listed hosts, as the editor and the publish check name them. */
export function listedImageHostsText(): string {
  const hosts = LISTED_IMAGE_SOURCES.map((source) => source.hostname)
  return `${hosts.slice(0, -1).join(', ')} or ${hosts[hosts.length - 1]}`
}

/**
 * The host a refusal names: the host of an `http` or `https` address. Null
 * when there is none to name (no parsable host, another scheme, a host longer
 * than DNS allows), and for a listed host refused for its scheme or path,
 * where naming it would read as a contradiction. A refusal names the host
 * only, so a long or odd address cannot change how the message reads.
 */
function refusedHost(src: string): string | null {
  let url: URL
  try {
    url = new URL(src.trim())
  } catch {
    return null
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null
  const host = url.hostname
  if (!host || host.length > 253) return null
  if (LISTED_IMAGE_SOURCES.some((source) => source.hostname === host))
    return null
  return host
}

/** The refusal for an image from another host, in the editor and on publish. */
export function imageSourceRefusal(src: unknown): string {
  const allowed = `Images must be uploaded, or come from ${listedImageHostsText()}.`
  if (typeof src !== 'string' || !src.trim()) {
    return `An image in this article has no address. Remove it, or upload the image. ${allowed}`
  }
  const host = refusedHost(src)
  return `${host ? `An image from ${host}` : 'That image address'} cannot be used. ${allowed}`
}

/** The refusal for a profile photo that is not an upload (#633). */
export const AVATAR_SOURCE_REFUSAL = 'Profile photos must be uploaded.'
