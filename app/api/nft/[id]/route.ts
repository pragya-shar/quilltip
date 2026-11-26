import { api } from '@/convex/_generated/api'
import { getConvexHttpClient } from '@/lib/convex-http-client'
import { nftMetadataResponse } from '@/lib/nft/metadataResponse'

export const dynamic = 'force-dynamic'

/**
 * Article NFT metadata for the v2 NFT contract's `token_uri`
 * (docs/architecture/v2/04-nft-contract.md, section 4.1). Serves tokens of
 * the NFT contract configured on this deployment's Convex backend.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const result = await nftMetadataResponse({
    rawId: id,
    origin: new URL(request.url).origin,
    ifNoneMatch: request.headers.get('if-none-match'),
    load: (tokenId) =>
      getConvexHttpClient().query(api.nftsV2.getTokenMetadata, { tokenId }),
  })
  return new Response(
    result.body === null ? null : JSON.stringify(result.body),
    { status: result.status, headers: result.headers }
  )
}
