export function buildArticlePublicPath(username: string, slug: string): string {
  return `/${username}/${slug}`
}

export function buildArticlePublicUrl(
  origin: string,
  username: string,
  slug: string
): string {
  const base = origin.replace(/\/$/, '')
  return `${base}${buildArticlePublicPath(username, slug)}`
}

