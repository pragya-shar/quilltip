/**
 * Builds profile URL with one NFT page param updated, preserving other query keys.
 */
export function buildProfileNftPaginationHref(
  pathname: string,
  searchParams: URLSearchParams,
  key: 'nftOwnedPage' | 'nftMintedPage',
  page: number
): string {
  const next = new URLSearchParams(searchParams.toString())
  if (page <= 1) next.delete(key)
  else next.set(key, String(page))
  const qs = next.toString()
  return qs ? `${pathname}?${qs}` : pathname
}
