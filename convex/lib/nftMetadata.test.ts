/// <reference types="vite/client" />
import type { Doc, Id } from '../_generated/dataModel'
import { describe, expect, it } from 'vitest'
import {
  buildNftMetadataPayload,
  isValidArweaveNftMetadataUrl,
} from './nftMetadata'

function baseArticle(overrides: Partial<Doc<'articles'>>): Doc<'articles'> {
  return {
    _id: 'jd7abc123' as Id<'articles'>,
    _creationTime: 1,
    slug: 'my-article',
    title: 'Short',
    content: {},
    published: true,
    authorId: 'jd7user123' as Id<'users'>,
    authorUsername: 'writer',
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  } as Doc<'articles'>
}

describe('buildNftMetadataPayload', () => {
  it('includes a very long title in JSON without data-URI inflation', () => {
    const longTitle = 'A'.repeat(450)
    const article = baseArticle({ title: longTitle })
    const tips = [{ amountUsd: 25 }]
    const xlm = 0.12
    const payload = buildNftMetadataPayload(
      article,
      tips,
      xlm,
      '2026-05-11T12:00:00.000Z'
    )

    expect(payload.name).toBe(`Quilltip Article: ${longTitle}`)

    const json = JSON.stringify(payload)
    const dataUri = `data:application/json,${encodeURIComponent(json)}`
    expect(json.length).toBeLessThan(dataUri.length)
    expect(json.length).toBeLessThan(8000)
  })

  it('computes stroops from tips and XLM price', () => {
    const article = baseArticle({ title: 'Hi' })
    const tips = [{ amountUsd: 12 }] // $12
    const xlm = 0.1 // $0.10 per XLM => 120 XLM => 120 * 10^7 stroops
    const payload = buildNftMetadataPayload(
      article,
      tips,
      xlm,
      '2026-01-01T00:00:00.000Z'
    )
    expect(payload.attributes.tipAmount).toBe(1_200_000_000)
    expect(payload.attributes.author).toBe('writer')
    expect(payload.attributes.articleSlug).toBe('my-article')
  })
})

describe('isValidArweaveNftMetadataUrl', () => {
  it('accepts arweave.net HTTPS tx URLs', () => {
    expect(
      isValidArweaveNftMetadataUrl(
        'https://arweave.net/abcdefghijklmnopqrstuvwxyz0123456789AB'
      )
    ).toBe(true)
  })

  it('rejects non-arweave and malformed URLs', () => {
    expect(isValidArweaveNftMetadataUrl('http://arweave.net/abc')).toBe(false)
    expect(
      isValidArweaveNftMetadataUrl(
        'https://example.com/abcdefghijklmnopqrstuvwxyz0123456789AB'
      )
    ).toBe(false)
    expect(
      isValidArweaveNftMetadataUrl(
        'https://arweave.net/short' // too short
      )
    ).toBe(false)
    expect(
      isValidArweaveNftMetadataUrl(
        'https://arweave.net/ab/cd' // path segment
      )
    ).toBe(false)
    expect(isValidArweaveNftMetadataUrl('data:application/json,{}')).toBe(false)
  })
})
