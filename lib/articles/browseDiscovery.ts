export const BROWSE_VIEWS = ['latest', 'trending', 'featured'] as const
export type BrowseView = (typeof BROWSE_VIEWS)[number]
export const DEFAULT_BROWSE_VIEW: BrowseView = 'latest'

export const BROWSE_SORTS = [
  'newest',
  'oldest',
  'most_tipped',
  'title',
] as const
export type BrowseSort = (typeof BROWSE_SORTS)[number]
export const DEFAULT_BROWSE_SORT: BrowseSort = 'newest'

export function parseBrowseView(value: string | null | undefined): BrowseView {
  if (value === 'trending' || value === 'featured') return value
  return DEFAULT_BROWSE_VIEW
}

export function parseBrowseSort(value: string | null | undefined): BrowseSort {
  if (value === 'oldest' || value === 'most_tipped' || value === 'title')
    return value
  return DEFAULT_BROWSE_SORT
}

export const READING_ROOM_CATEGORIES = [
  'stories',
  'thoughts',
  'anecdotes',
] as const
export type ReadingRoomCategory = (typeof READING_ROOM_CATEGORIES)[number]

export function parseReadingRoomCategory(value: string | null | undefined) {
  return READING_ROOM_CATEGORIES.find((category) => category === value)
}

// Older articles may carry no category tag; publish defaults those to Stories,
// so cards, the reader and the Reading Room filters treat them the same way.
export const DEFAULT_READING_ROOM_CATEGORY: ReadingRoomCategory = 'stories'

export function articleCategory(
  tags: readonly string[] | undefined
): ReadingRoomCategory {
  for (const tag of tags ?? []) {
    const category = parseReadingRoomCategory(tag.trim().toLowerCase())
    if (category) return category
  }
  return DEFAULT_READING_ROOM_CATEGORY
}

export function articleCategoryLabel(tags: readonly string[] | undefined) {
  const category = articleCategory(tags)
  return category.charAt(0).toUpperCase() + category.slice(1)
}
