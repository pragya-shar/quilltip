export const BROWSE_VIEWS = ['latest', 'trending', 'featured'] as const
export type BrowseView = (typeof BROWSE_VIEWS)[number]
export const DEFAULT_BROWSE_VIEW: BrowseView = 'latest'

export const BROWSE_SORTS = ['newest', 'oldest', 'most_tipped'] as const
export type BrowseSort = (typeof BROWSE_SORTS)[number]
export const DEFAULT_BROWSE_SORT: BrowseSort = 'newest'

export function parseBrowseView(value: string | null | undefined): BrowseView {
  if (value === 'trending' || value === 'featured') return value
  return DEFAULT_BROWSE_VIEW
}

export function parseBrowseSort(value: string | null | undefined): BrowseSort {
  if (value === 'oldest' || value === 'most_tipped') return value
  return DEFAULT_BROWSE_SORT
}
