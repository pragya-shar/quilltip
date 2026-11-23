import { getAuthUserId } from '@convex-dev/auth/server'
import { action } from './_generated/server'
import { v } from 'convex/values'

import {
  fetchWikimediaDirectImageUrl,
  parseWikimediaFileTitleFromPageUrl,
} from './lib/wikimediaFileUrl'

/**
 * Resolves a Wikipedia / Wikimedia Commons "File:" page URL to a direct image URL.
 * Non-file URLs are not handled here; the client should use the original string.
 * Signed-in users only, so anonymous callers cannot make the backend fetch Wikimedia.
 */
export const resolveWikimediaFileUrl = action({
  args: { pageUrl: v.string() },
  handler: async (ctx, { pageUrl }) => {
    const userId = await getAuthUserId(ctx)
    if (!userId) throw new Error('Not authenticated')

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
