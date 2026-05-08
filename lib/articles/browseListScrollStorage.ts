export const ARTICLES_BROWSE_SCROLL_STORAGE_PREFIX =
  'quilltip:articlesBrowseScroll:'

export function buildArticlesBrowseScrollStorageKey(
  pathname: string,
  searchParamsString: string
): string {
  const pathAndQuery =
    searchParamsString.length > 0
      ? `${pathname}?${searchParamsString}`
      : pathname
  return `${ARTICLES_BROWSE_SCROLL_STORAGE_PREFIX}${pathAndQuery}`
}

export function writeBrowseScrollY(storageKey: string, y: number): void {
  if (typeof window === 'undefined') return
  if (!Number.isFinite(y) || y < 0) return
  try {
    window.sessionStorage.setItem(storageKey, String(Math.round(y)))
  } catch {
    // Quota or private mode
  }
}

export function readBrowseScrollY(storageKey: string): number | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = window.sessionStorage.getItem(storageKey)
    if (raw === null) return null
    const n = Number.parseFloat(raw)
    if (!Number.isFinite(n) || n < 0) return null
    return Math.round(n)
  } catch {
    return null
  }
}
