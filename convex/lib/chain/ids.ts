/**
 * Payments v2 identifiers (docs/architecture/v2/01-architecture.md, section
 * 1.4). Pure functions with no dependencies beyond Web Crypto, shared by
 * Convex functions, Node actions and the client. The shared test vectors in
 * `contracts/shared/test-vectors.json` pin their output.
 */

import { canonicalJsonBytes } from './canonicalJson'

/** Version tag inside the canonical article object. */
export const ARTICLE_SCHEMA = 'quilltip-article-v1'

/** The article fields that the canonical bytes cover. */
export type CanonicalArticleInput = {
  /** Convex `articles` document ID. */
  articleId: string
  /** Convex `users` document ID of the author. */
  authorId: string
  title: string
  /** The stored TipTap JSON document, unchanged. */
  content: unknown
  /** 1 at first publish, plus 1 for each content update. */
  contentVersion: number
}

/** The object that `canonicalArticleBytes` serialises. */
export type CanonicalArticle = CanonicalArticleInput & {
  schema: typeof ARTICLE_SCHEMA
}

export class CanonicalArticleError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'CanonicalArticleError'
  }
}

/**
 * Builds the canonical article object. Only these six fields are included:
 * no timestamps and no display fields (username, avatar, excerpt).
 */
export function canonicalArticle(
  article: CanonicalArticleInput
): CanonicalArticle {
  const { articleId, authorId, title, content, contentVersion } = article
  if (typeof articleId !== 'string' || articleId.length === 0) {
    throw new CanonicalArticleError('articleId must be a non-empty string')
  }
  if (typeof authorId !== 'string' || authorId.length === 0) {
    throw new CanonicalArticleError('authorId must be a non-empty string')
  }
  if (typeof title !== 'string') {
    throw new CanonicalArticleError('title must be a string')
  }
  if (content === undefined) {
    throw new CanonicalArticleError('content is required')
  }
  if (
    !Number.isSafeInteger(contentVersion) ||
    contentVersion < 1 ||
    contentVersion > 0xffffffff
  ) {
    throw new CanonicalArticleError(
      'contentVersion must be an integer from 1 to 4294967295'
    )
  }
  return {
    schema: ARTICLE_SCHEMA,
    articleId,
    authorId,
    title,
    content,
    contentVersion,
  }
}

/**
 * `canonicalArticleBytes(article)`: UTF-8 of the RFC 8785 serialisation of
 * the canonical article object. This is also the exact Arweave upload body.
 */
export function canonicalArticleBytes(
  article: CanonicalArticleInput
): Uint8Array {
  return canonicalJsonBytes(canonicalArticle(article))
}

/** SHA-256 of `bytes` through Web Crypto (Convex, Node 20+, browsers). */
export async function sha256(bytes: Uint8Array): Promise<Uint8Array> {
  const digest = await crypto.subtle.digest('SHA-256', bytes as BufferSource)
  return new Uint8Array(digest)
}

/** Lower-case hex of `bytes`. */
export function bytesToHex(bytes: Uint8Array): string {
  let hex = ''
  for (const byte of bytes) hex += byte.toString(16).padStart(2, '0')
  return hex
}

/** `content_hash`: SHA-256 of the canonical article bytes, 32 bytes. */
export async function articleContentHash(
  article: CanonicalArticleInput
): Promise<Uint8Array> {
  return sha256(canonicalArticleBytes(article))
}

/** `content_hash` as 64 lower-case hex characters, the stored form. */
export async function articleContentHashHex(
  article: CanonicalArticleInput
): Promise<string> {
  return bytesToHex(await articleContentHash(article))
}
