/**
 * Article content as it is stored. Applied by every mutation that saves an
 * article body (`createArticle`, `updateArticle`, `saveDraft`).
 *
 * A link mark keeps only its address: `rel`, `target`, `class` and `title`
 * come from the renderers (`lib/tiptap/articleLink.ts`), never from the
 * document. The renderers apply the same rule to documents saved before this
 * existed, so they need no migration (#612).
 */

type Json = Record<string, unknown>

function isRecord(value: unknown): value is Json {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function storedMark(mark: unknown): unknown {
  if (!isRecord(mark) || mark.type !== 'link') return mark
  const href =
    isRecord(mark.attrs) && typeof mark.attrs.href === 'string'
      ? mark.attrs.href
      : null
  return { type: 'link', attrs: { href } }
}

/** A copy of `content` whose link marks carry only `href`. */
export function storedArticleContent(content: unknown): unknown {
  if (Array.isArray(content)) return content.map(storedArticleContent)
  if (!isRecord(content)) return content
  const node: Json = { ...content }
  if (Array.isArray(content.marks)) node.marks = content.marks.map(storedMark)
  if (Array.isArray(content.content)) {
    node.content = content.content.map(storedArticleContent)
  }
  return node
}
