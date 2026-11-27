/**
 * Article identifiers for the v2 contracts, as bytes, for clients and scripts
 * that call Core through the generated bindings.
 *
 * - `article_ref`: `sha256("quilltip:article:v1:" || convex_id)`, the app's
 *   reference to an article. `register_article` takes it.
 * - `article_id`: `sha256("quilltip:article:v2:" || author_strkey || article_ref)`,
 *   the ID Core stores. Only `author` can register it.
 *
 * `contracts/shared/src/ids.rs` defines both and `contracts/shared/test-vectors.json`
 * fixes the expected values. `convex/lib/chain/ids.ts` derives the same values
 * as hex for Convex.
 */
import { StrKey, hash } from '@stellar/stellar-sdk'

/** SHA-256 without Node's `Buffer`, so the encoders also run in browsers. */
function sha256(bytes: Uint8Array): Uint8Array {
  return new Uint8Array(hash(bytes))
}

export const ARTICLE_REF_PREFIX = 'quilltip:article:v1:'
export const ARTICLE_ID_PREFIX = 'quilltip:article:v2:'

export class ArticleIdError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ArticleIdError'
  }
}

/** `article_ref` for a Convex `articles` `_id`. */
export function articleRef(convexArticleId: string): Uint8Array {
  if (!convexArticleId) throw new ArticleIdError('convexArticleId is empty')
  return sha256(new TextEncoder().encode(ARTICLE_REF_PREFIX + convexArticleId))
}

/** `article_id` that Core derives for `author` and `articleRef`. */
export function articleId(author: string, ref: Uint8Array): Uint8Array {
  if (
    !StrKey.isValidEd25519PublicKey(author) &&
    !StrKey.isValidContract(author)
  ) {
    throw new ArticleIdError('author must be a G or C address')
  }
  if (ref.length !== 32) throw new ArticleIdError('articleRef must be 32 bytes')
  const prefix = new TextEncoder().encode(ARTICLE_ID_PREFIX + author)
  const preimage = new Uint8Array(prefix.length + 32)
  preimage.set(prefix)
  preimage.set(ref, prefix.length)
  return sha256(preimage)
}

/**
 * `highlight_id` for a passage: `sha256("{slug}:{start}:{end}:{text[0..50]}")`
 * (01-architecture.md, section 1.4). `text` is cut at 50 UTF-16 code units,
 * as the v1 highlight ID and `convex/lib/chain/tipPrepare.ts` do.
 */
export function highlightId(
  articleSlug: string,
  startOffset: number,
  endOffset: number,
  text: string
): Uint8Array {
  return sha256(
    new TextEncoder().encode(
      `${articleSlug}:${startOffset}:${endOffset}:${text.slice(0, 50)}`
    )
  )
}
