import { extractTextFromTiptapJson } from '@/convex/lib/tiptapContent'

/**
 * Characters of the article's opening kept for list cards. Cards show the
 * subtitle, or without one the opening of the body: the first 240 characters
 * (getArticlePreview) or the first sentence up to 160 (getArticleOpening).
 */
export const LIST_OPENING_CHARS = 600

type ListArticle = { content?: unknown; searchContent?: unknown }

/**
 * The copy of a list article that the server sends with the first HTML. The
 * full document and the search text are replaced by the opening the cards
 * read, so the page does not carry every listed article's body. Cards render
 * the same text; the live query brings full rows after load.
 */
export function listArticleForClient<T extends ListArticle>(article: T): T {
  const { content } = article
  const opening = extractTextFromTiptapJson(content)
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, LIST_OPENING_CHARS)
  return {
    ...article,
    searchContent: undefined,
    content: opening
      ? {
          type: 'doc',
          content: [
            { type: 'paragraph', content: [{ type: 'text', text: opening }] },
          ],
        }
      : content,
  }
}
