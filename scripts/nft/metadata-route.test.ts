/**
 * `GET /api/nft/{token_id}` (docs/architecture/v2/04-nft-contract.md, 4.1):
 * status codes, cache headers, the testnet label and the route wiring.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { NftTokenMetadata } from '@/convex/nftsV2'
import {
  CACHE_ERROR,
  CACHE_FOUND,
  CACHE_INVALID,
  CACHE_UNKNOWN,
  asSentence,
  nftMetadataResponse,
  parseTokenId,
} from '@/lib/nft/metadataResponse'

const query = vi.fn()
vi.mock('@/lib/convex-http-client', () => ({
  getConvexHttpClient: () => ({ query }),
}))

const META: NftTokenMetadata = {
  tokenId: 3,
  network: 'TESTNET',
  contractId: 'CCOJOXITZQM7R6FSFPICN4Y3GONM4TN4Y6QV64CARDHNNRUT3U5SCYT7',
  available: true,
  title: 'Words',
  excerpt: 'About words.',
  authorUsername: 'writer',
  slug: 'on words',
  contentHash: '12'.repeat(32),
  contentVersion: 2,
  arweaveId: 'NDQ0NDQ0NDQ0NDQ0NDQ0NDQ0NDQ0NDQ0NDQ0NDQ0NDQ',
  minterAddress: 'GAVCIIZTMO4XXPDEJNIPQCD7CZQVBH7ABJMJEQJDQXG2E2KZFQANXZW2',
  mintedAt: 1_795_000_000_000,
}

const respond = (
  rawId: string,
  meta: NftTokenMetadata | null | Error = META,
  ifNoneMatch: string | null = null
) =>
  nftMetadataResponse({
    rawId,
    origin: 'https://preview.example.test',
    ifNoneMatch,
    load: async () => {
      if (meta instanceof Error) throw meta
      return meta
    },
  })

afterEach(() => {
  query.mockReset()
  vi.restoreAllMocks()
})

describe('parseTokenId', () => {
  it('accepts only the decimal u32 the contract writes', () => {
    expect(parseTokenId('0')).toBe(0)
    expect(parseTokenId('4294967295')).toBe(4294967295)
    for (const bad of [
      '',
      '01',
      '-1',
      '1.0',
      '4294967296',
      '1e3',
      ' 1',
      'abc',
    ]) {
      expect(parseTokenId(bad), bad).toBeNull()
    }
  })
})

describe('asSentence (#547)', () => {
  it('ends a subtitle with a full stop unless it already ends a sentence', () => {
    expect(asSentence('Notes on slow reading')).toBe('Notes on slow reading.')
    expect(asSentence('About words.')).toBe('About words.')
    expect(asSentence('Why read slowly?')).toBe('Why read slowly?')
    expect(asSentence('“Read it twice.”')).toBe('“Read it twice.”')
    expect(asSentence('Wait…')).toBe('Wait…')
  })
})

describe('nftMetadataResponse', () => {
  it('separates a subtitle without a full stop from the network line', async () => {
    const res = await respond('3', {
      ...META,
      excerpt: 'Notes on slow reading',
    })
    expect((res.body as { description: string }).description).toBe(
      'Notes on slow reading. Minted on the Stellar testnet.'
    )
  })

  it('serves the section 4.1 JSON with the testnet label', async () => {
    const res = await respond('3')
    expect(res.status).toBe(200)
    expect(res.headers['Cache-Control']).toBe(CACHE_FOUND)
    expect(res.headers['Content-Type']).toBe('application/json; charset=utf-8')
    expect(res.headers.ETag).toMatch(/^"[A-Za-z0-9_-]{27}"$/)
    expect(res.body).toEqual({
      name: 'Words',
      description: 'About words. Minted on the Stellar testnet.',
      external_url: 'https://preview.example.test/writer/on%20words',
      attributes: [
        { trait_type: 'content_hash', value: '12'.repeat(32) },
        { trait_type: 'arweave_id', value: META.arweaveId },
        { trait_type: 'content_version', value: 2 },
        { trait_type: 'network', value: 'Stellar testnet' },
      ],
    })
  })

  it('answers 304 for a matching ETag and 200 when the content changed', async () => {
    const first = await respond('3')
    const etag = first.headers.ETag!
    const again = await respond('3', META, `W/${etag}`)
    expect(again.status).toBe(304)
    expect(again.body).toBeNull()
    expect(again.headers['Cache-Control']).toBe(CACHE_FOUND)
    const changed = await respond('3', { ...META, title: 'New title' }, etag)
    expect(changed.status).toBe(200)
    expect(changed.headers.ETag).not.toBe(etag)
  })

  it('leaves out the article and its content attributes while the article is not available', async () => {
    // Even if a loader returned content fields, they are not served.
    const res = await respond('3', {
      ...META,
      available: false,
      title: null,
      excerpt: null,
      authorUsername: null,
      slug: null,
    })
    expect(res.status).toBe(200)
    expect(res.body).toEqual({
      name: 'QuillTip Article #3',
      description:
        'This article is not available on Quilltip. Minted on the Stellar testnet.',
      attributes: [{ trait_type: 'network', value: 'Stellar testnet' }],
    })
  })

  it('omits a missing anchor of an available article', async () => {
    const res = await respond('3', { ...META, arweaveId: null })
    expect((res.body as { attributes: unknown[] }).attributes).toEqual([
      { trait_type: 'content_hash', value: '12'.repeat(32) },
      { trait_type: 'content_version', value: 2 },
      { trait_type: 'network', value: 'Stellar testnet' },
    ])
  })

  it('returns 400, 404 and 503 with matching cache headers', async () => {
    const bad = await respond('07')
    expect(bad.status).toBe(400)
    expect(bad.headers['Cache-Control']).toBe(CACHE_INVALID)
    const unknown = await respond('9', null)
    expect(unknown.status).toBe(404)
    expect(unknown.headers['Cache-Control']).toBe(CACHE_UNKNOWN)
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const down = await respond('9', new Error('backend down'))
    expect(down.status).toBe(503)
    expect(down.headers['Cache-Control']).toBe(CACHE_ERROR)
  })
})

describe('GET /api/nft/[id]', () => {
  it('reads the public Convex query and returns its JSON', async () => {
    const { GET } = await import('../../app/api/nft/[id]/route')
    query.mockResolvedValueOnce(META)
    const res = await GET(new Request('https://www.quilltip.me/api/nft/3'), {
      params: Promise.resolve({ id: '3' }),
    })
    expect(res.status).toBe(200)
    expect(query).toHaveBeenCalledWith(expect.anything(), { tokenId: 3 })
    const body = (await res.json()) as { external_url: string }
    expect(body.external_url).toBe('https://www.quilltip.me/writer/on%20words')
    expect(res.headers.get('cache-control')).toBe(CACHE_FOUND)

    query.mockResolvedValueOnce(null)
    const missing = await GET(
      new Request('https://www.quilltip.me/api/nft/4'),
      {
        params: Promise.resolve({ id: '4' }),
      }
    )
    expect(missing.status).toBe(404)

    const invalid = await GET(
      new Request('https://www.quilltip.me/api/nft/x'),
      {
        params: Promise.resolve({ id: 'x' }),
      }
    )
    expect(invalid.status).toBe(400)
    expect(query).toHaveBeenCalledTimes(2)
  })

  it('serves no content attributes for an unavailable article', async () => {
    const { GET } = await import('../../app/api/nft/[id]/route')
    query.mockResolvedValueOnce({ ...META, available: false })
    const res = await GET(new Request('https://www.quilltip.me/api/nft/3'), {
      params: Promise.resolve({ id: '3' }),
    })
    expect(res.status).toBe(200)
    const text = await res.text()
    expect(JSON.parse(text)).toEqual({
      name: 'QuillTip Article #3',
      description:
        'This article is not available on Quilltip. Minted on the Stellar testnet.',
      attributes: [{ trait_type: 'network', value: 'Stellar testnet' }],
    })
    expect(text).not.toContain(META.contentHash!)
    expect(text).not.toContain(META.arweaveId!)
  })
})
