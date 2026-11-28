import Youtube from '@tiptap/extension-youtube'
import {
  renderYoutubeEmbed,
  YOUTUBE_EMBED_OPTIONS,
} from '@/lib/tiptap/youtubeEmbed'

export {
  articleEmbedSrc,
  youtubeVideoId,
  youtubeWatchAddress,
} from '@/lib/articles/youtubeVideo'

/**
 * The video node for the editors: `@tiptap/extension-youtube`, for its
 * insert command and paste rule, rendering as the readers do
 * (`renderYoutubeEmbed`). The readers use `createReaderYoutubeNode`.
 */
export function createYoutubeExtension() {
  return Youtube.extend({
    renderHTML({ HTMLAttributes }) {
      return renderYoutubeEmbed(HTMLAttributes, this.options)
    },
  }).configure({
    ...YOUTUBE_EMBED_OPTIONS,
    controls: true,
    nocookie: true,
  })
}
