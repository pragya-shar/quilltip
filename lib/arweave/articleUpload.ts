import {
  ARTICLE_SCHEMA,
  articleContentHashHex,
  canonicalArticleBytes,
  type CanonicalArticleInput,
} from '../../convex/lib/chain/ids'
import { ARWEAVE_CONFIG } from './config'
import type { ArweaveDataTag } from './types'

export type ArticleUploadInput = CanonicalArticleInput & {
  /** Display-only author handle, sent as a tag. */
  authorUsername: string
  /** Upload time in milliseconds, sent as a tag, never in the body. */
  uploadedAt: number
}

export type ArticleUpload = {
  /** Exactly `canonicalArticleBytes(article)`. */
  body: Uint8Array
  /** SHA-256 of `body`, lower-case hex. Equal to the article's `contentHash`. */
  contentHash: string
  tags: ArweaveDataTag[]
}

/**
 * The Arweave data item for an article. The body is the canonical article
 * bytes, so anyone can fetch it and recompute `content_hash` with SHA-256.
 * Metadata that would change the bytes (upload time, display names) lives in
 * the tags.
 */
export async function buildArticleUpload(
  input: ArticleUploadInput
): Promise<ArticleUpload> {
  const article: CanonicalArticleInput = {
    articleId: input.articleId,
    authorId: input.authorId,
    title: input.title,
    content: input.content,
    contentVersion: input.contentVersion,
  }
  const body = canonicalArticleBytes(article)
  const contentHash = await articleContentHashHex(article)
  return {
    body,
    contentHash,
    tags: [
      { name: 'Content-Type', value: 'application/json; charset=utf-8' },
      { name: 'App-Name', value: ARWEAVE_CONFIG.APP_NAME },
      { name: 'App-Version', value: ARWEAVE_CONFIG.APP_VERSION },
      { name: 'Schema', value: ARTICLE_SCHEMA },
      { name: 'Article-Id', value: input.articleId },
      { name: 'Author-Id', value: input.authorId },
      { name: 'Article-Title', value: input.title },
      { name: 'Author', value: input.authorUsername },
      { name: 'Content-Version', value: String(input.contentVersion) },
      { name: 'Content-Hash', value: contentHash },
      { name: 'Timestamp', value: String(input.uploadedAt) },
    ],
  }
}
