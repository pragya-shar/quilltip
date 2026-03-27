import { action } from './_generated/server'
import { v } from 'convex/values'

import {
  fetchWikimediaDirectImageUrl,
  parseWikimediaFileTitleFromPageUrl,
} from './lib/wikimediaFileUrl'

/**
 * Resolves a Wikipedia / Wikimedia Commons "File:" page URL to a direct image URL.
 * Non-file URLs are not handled here; the client should use the original string.
 */
export const resolveWikimediaFileUrl = action({
  args: { pageUrl: v.string() },
  handler: async (_ctx, { pageUrl }) => {
    const title = parseWikimediaFileTitleFromPageUrl(pageUrl)
    if (!title) {
      return { kind: 'not_file_page' as const }
    }

    const directUrl = await fetchWikimediaDirectImageUrl(title)
    if (!directUrl) {
      return { kind: 'unresolved' as const }
    }

    return { kind: 'ok' as const, directUrl }
  },
})
