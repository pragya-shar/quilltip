/**
 * The response of `GET /api/nft/{token_id}`: the article NFT metadata of
 * docs/architecture/v2/04-nft-contract.md, section 4.1.
 *
 * The NFT contract's `token_uri(id)` is its `base_uri` followed by the
 * decimal token ID, with no extension, so the route answers at
 * `/api/nft/<id>`. The data comes from the Core registry as indexed in Convex
 * (`content_hash`, `arweave_id`) and from the article row.
 *
 * Caching: the token-to-article link never changes, but the title, the
 * excerpt and the anchored content hash change when the author updates the
 * article. A found token is cached for 5 minutes with an ETag; an unknown
 * token for 30 seconds, because the indexer records a new mint within about
 * a minute; a malformed ID for a day.
 */
import { createHash } from 'node:crypto'

import type { NftTokenMetadata } from '@/convex/nftsV2'
import { articlePath } from '@/lib/seo/siteMetadata'

export const MAX_TOKEN_ID = 0xffffffff

export const CACHE_FOUND =
  'public, max-age=300, s-maxage=300, stale-while-revalidate=86400'
export const CACHE_UNKNOWN = 'public, max-age=30, s-maxage=30'
export const CACHE_INVALID = 'public, max-age=86400, s-maxage=86400'
export const CACHE_ERROR = 'no-store'

export type NftMetadataJson = {
  name: string
  description: string
  external_url?: string
  attributes: Array<{ trait_type: string; value: string | number }>
}

export type NftMetadataResponse = {
  status: 200 | 304 | 400 | 404 | 503
  headers: Record<string, string>
  body: NftMetadataJson | { error: string } | null
}

/** A token ID as the contract writes it: a u32 in decimal, no leading zeros. */
export function parseTokenId(raw: string): number | null {
  if (!/^(0|[1-9][0-9]{0,9})$/.test(raw)) return null
  const id = Number(raw)
  return id <= MAX_TOKEN_ID ? id : null
}

function networkLabel(network: NftTokenMetadata['network']): string {
  return network === 'TESTNET' ? 'Stellar testnet' : 'Stellar'
}

export function buildNftMetadata(
  meta: NftTokenMetadata,
  origin: string
): NftMetadataJson {
  const network = networkLabel(meta.network)
  const attributes: NftMetadataJson['attributes'] = []
  // Content attributes lead to the article body, so they are left out while
  // the article is not available, whatever the loader returns.
  if (!meta.available) {
    return {
      name: `QuillTip Article #${meta.tokenId}`,
      description: `This article is not available on QuillTip. Minted on the ${network}.`,
      attributes: [{ trait_type: 'network', value: network }],
    }
  }
  if (meta.contentHash) {
    attributes.push({ trait_type: 'content_hash', value: meta.contentHash })
  }
  if (meta.arweaveId) {
    attributes.push({ trait_type: 'arweave_id', value: meta.arweaveId })
  }
  if (meta.contentVersion !== null) {
    attributes.push({
      trait_type: 'content_version',
      value: meta.contentVersion,
    })
  }
  attributes.push({ trait_type: 'network', value: network })

  if (!meta.title || !meta.authorUsername || !meta.slug) {
    return {
      name: `QuillTip Article #${meta.tokenId}`,
      description: `This article is not available on QuillTip. Minted on the ${network}.`,
      attributes,
    }
  }
  const summary =
    meta.excerpt?.trim() || `An article by @${meta.authorUsername} on QuillTip.`
  return {
    name: meta.title,
    description: `${summary} Minted on the ${network}.`,
    external_url: `${origin.replace(/\/+$/, '')}${articlePath(meta.authorUsername, meta.slug)}`,
    attributes,
  }
}

function etagOf(body: NftMetadataJson): string {
  return `"${createHash('sha256').update(JSON.stringify(body)).digest('base64url').slice(0, 27)}"`
}

function matches(ifNoneMatch: string | null, etag: string): boolean {
  if (!ifNoneMatch) return false
  return ifNoneMatch
    .split(',')
    .map((t) => t.trim().replace(/^W\//, ''))
    .some((t) => t === etag || t === '*')
}

export async function nftMetadataResponse(args: {
  rawId: string
  origin: string
  ifNoneMatch: string | null
  load: (tokenId: number) => Promise<NftTokenMetadata | null>
}): Promise<NftMetadataResponse> {
  const json = { 'Content-Type': 'application/json; charset=utf-8' }
  const tokenId = parseTokenId(args.rawId)
  if (tokenId === null) {
    return {
      status: 400,
      headers: { ...json, 'Cache-Control': CACHE_INVALID },
      body: { error: 'Token ID must be a whole number from 0 to 4294967295.' },
    }
  }
  let meta: NftTokenMetadata | null
  try {
    meta = await args.load(tokenId)
  } catch (error) {
    console.error(
      JSON.stringify({
        code: 'NFT_METADATA_LOAD_FAILED',
        tokenId,
        message: error instanceof Error ? error.message : String(error),
      })
    )
    return {
      status: 503,
      headers: { ...json, 'Cache-Control': CACHE_ERROR },
      body: { error: 'Metadata is unavailable. Try again later.' },
    }
  }
  if (!meta) {
    return {
      status: 404,
      headers: { ...json, 'Cache-Control': CACHE_UNKNOWN },
      body: { error: 'Unknown token.' },
    }
  }
  const body = buildNftMetadata(meta, args.origin)
  const etag = etagOf(body)
  const headers = { ...json, 'Cache-Control': CACHE_FOUND, ETag: etag }
  if (matches(args.ifNoneMatch, etag)) {
    return { status: 304, headers, body: null }
  }
  return { status: 200, headers, body }
}
