/**
 * Tip targets from strings. The article view holds an article id as a string
 * from the server HTML; these check it at that boundary and return it typed,
 * or null. The check is the shape of a document id; the server checks the
 * table (`v.id('articles')`), so a string that names a row of another table
 * passes here and fails there, and that tip fails with nothing charged.
 */
import type { Id } from '@/convex/_generated/dataModel'
import type { PassageRef, TipTarget } from './types'

/** A document id: 31 to 37 characters of lowercase base32 (no i, l, o, u). */
const DOCUMENT_ID = /^[0-9a-hjkmnp-tv-z]{31,37}$/

export function articleIdOf(value: unknown): Id<'articles'> | null {
  return typeof value === 'string' && DOCUMENT_ID.test(value)
    ? (value as Id<'articles'>)
    : null
}

/** A whole-article target, or a passage target when `passage` is given. */
export function tipTargetOf(
  articleId: unknown,
  passage?: PassageRef
): TipTarget | null {
  const id = articleIdOf(articleId)
  if (!id) return null
  return passage
    ? { kind: 'passage', articleId: id, passage }
    : { kind: 'article', articleId: id }
}
