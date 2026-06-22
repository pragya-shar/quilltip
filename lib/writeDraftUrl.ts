/** Build /write URL with draft id, or null if the id is already in the query string. */
export function getWriteUrlWithDraftId(
  searchParams: string,
  draftId: string
): string | null {
  const params = new URLSearchParams(
    searchParams.startsWith('?') ? searchParams.slice(1) : searchParams
  )
  if (params.get('id') === draftId) return null
  params.set('id', draftId)
  const query = params.toString()
  return query ? `/write?${query}` : `/write?id=${draftId}`
}
