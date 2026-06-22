import type { Doc } from '../_generated/dataModel'

export interface NftMetadataPayload {
  name: string
  description: string
  image: string
  external_url: string
  attributes: {
    author: string
    tipAmount: number
    mintDate: string
    articleSlug: string
  }
}

export function isValidArweaveNftMetadataUrl(url: string): boolean {
  try {
    const u = new URL(url)
    if (u.protocol !== 'https:' || u.hostname !== 'arweave.net') return false
    const path = u.pathname.replace(/^\//, '')
    if (!path || path.includes('/')) return false
    if (path.length < 20 || path.length > 128) return false
    return /^[A-Za-z0-9_-]+$/.test(path)
  } catch {
    return false
  }
}

export function buildNftMetadataPayload(
  article: Doc<'articles'>,
  tips: Array<{ amountUsd: number }>,
  xlmPrice: number,
  mintDateIso: string = new Date().toISOString()
): NftMetadataPayload {
  const totalTipsUsd = tips.reduce((sum, tip) => sum + tip.amountUsd, 0)
  const tipAmountInStroops = Math.floor((totalTipsUsd / xlmPrice) * 10_000_000)

  return {
    name: `Quilltip Article: ${article.title}`,
    description:
      article.excerpt || `An article by ${article.authorUsername} on Quilltip`,
    image: article.coverImage || 'https://quilltip.me/default-nft-image.png',
    external_url: `https://quilltip.me/${article.authorUsername}/${article.slug}`,
    attributes: {
      author: article.authorUsername,
      tipAmount: tipAmountInStroops,
      mintDate: mintDateIso,
      articleSlug: article.slug,
    },
  }
}
