import {
  parseBrowseSort,
  parseBrowseView,
  parseReadingRoomCategory,
} from '@/lib/articles/browseDiscovery'
import { parseArticlesPageParam } from '@/lib/articles/parseArticlesPageParam'

export const READING_ROOM_PAGE_SIZE = 9

/**
 * The `listArticles` arguments for a Reading Room URL without bookmarks.
 * Shared by the server page (first HTML) and the client (live query), so both
 * ask for the same list.
 */
export function readingRoomListArgs(params: {
  get(name: string): string | null
}) {
  const search = params.get('search') || undefined
  return {
    page: parseArticlesPageParam(params.get('page')),
    limit: READING_ROOM_PAGE_SIZE,
    tag: params.get('tag') || undefined,
    category: parseReadingRoomCategory(params.get('category')),
    searchByWriterOrTitle: search ? true : undefined,
    author: params.get('author') || undefined,
    search,
    view: parseBrowseView(params.get('view')),
    sort: parseBrowseSort(params.get('sort')),
  }
}

/** Stable key for comparing argument sets (undefined fields drop out). */
export function readingRoomListKey(
  args: ReturnType<typeof readingRoomListArgs>
) {
  return JSON.stringify(args)
}
