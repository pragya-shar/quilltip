/**
 * Checks lib/stellar/v2/ids.ts against the Rust test vectors and against the
 * Convex derivation in convex/lib/chain/ids.ts.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import {
  articleIdHex,
  articleRefHex,
  bytesToHex,
  hexToBytes,
} from '../../convex/lib/chain/ids'
import { ArticleIdError, articleId, articleRef } from '../../lib/stellar/v2/ids'

const vectors = JSON.parse(
  readFileSync(
    join(__dirname, '../../contracts/shared/test-vectors.json'),
    'utf8'
  )
) as {
  identifiers: {
    article_refs: Array<{ article_ref: string; convex_id: string }>
    article_ids: Array<{
      author: string
      article_ref: string
      article_id: string
    }>
  }
}

describe('v2 article identifiers', () => {
  it.each(vectors.identifiers.article_refs)(
    'article_ref for $convex_id',
    async ({ convex_id, article_ref }) => {
      expect(bytesToHex(articleRef(convex_id))).toBe(article_ref)
      expect(await articleRefHex(convex_id)).toBe(article_ref)
    }
  )

  it.each(vectors.identifiers.article_ids)(
    'article_id for $author',
    async ({ author, article_ref, article_id }) => {
      expect(bytesToHex(articleId(author, hexToBytes(article_ref)))).toBe(
        article_id
      )
      expect(await articleIdHex(author, article_ref)).toBe(article_id)
    }
  )

  it('refuses a bad author or reference', () => {
    const ref = articleRef('j57a3k9w8m2x4p6q1r5t7v9y0z3b8c2d')
    expect(() => articleId('not-an-address', ref)).toThrow(ArticleIdError)
    expect(() =>
      articleId(vectors.identifiers.article_ids[0]!.author, ref.slice(1))
    ).toThrow(ArticleIdError)
    expect(() => articleRef('')).toThrow(ArticleIdError)
  })
})
