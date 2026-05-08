/**
 * Wikimedia "File:" wiki pages are HTML; avatars need a direct image URL.
 * These helpers use the MediaWiki API to resolve File: page URLs.
 */

export function parseWikimediaFileTitleFromPageUrl(
  urlString: string
): string | null {
  let u: URL
  try {
    u = new URL(urlString.trim())
  } catch {
    return null
  }

  const host = u.hostname.toLowerCase()
  const isWikimediaFileHost =
    host === 'commons.wikimedia.org' ||
    host.endsWith('.wikipedia.org') ||
    host === 'wikipedia.org'

  if (!isWikimediaFileHost) return null

  const match = u.pathname.match(/^\/wiki\/(File:.+)$/i)
  if (!match?.[1]) return null

  const raw = decodeURIComponent(match[1])
  return raw.replace(/_/g, ' ')
}

type ApiPage = {
  missing?: boolean
  imageinfo?: { url: string }[]
}

type ApiResponse = {
  query?: { pages?: Record<string, ApiPage> }
}

async function fetchDirectUrlFromEndpoint(
  apiBase: string,
  title: string
): Promise<string | null> {
  const apiUrl = `${apiBase}?${new URLSearchParams({
    action: 'query',
    titles: title,
    prop: 'imageinfo',
    iiprop: 'url',
    format: 'json',
  }).toString()}`

  const res = await fetch(apiUrl)
  if (!res.ok) return null

  const data = (await res.json()) as ApiResponse
  const pages = data.query?.pages
  if (!pages) return null

  const page = Object.values(pages)[0]
  if (!page || page.missing) return null

  return page.imageinfo?.[0]?.url ?? null
}

export async function fetchWikimediaDirectImageUrl(
  fileTitle: string
): Promise<string | null> {
  const direct =
    (await fetchDirectUrlFromEndpoint(
      'https://commons.wikimedia.org/w/api.php',
      fileTitle
    )) ??
    (await fetchDirectUrlFromEndpoint(
      'https://en.wikipedia.org/w/api.php',
      fileTitle
    ))

  return direct
}
