import { describe, expect, it } from 'vitest'
import { buildProfileNftPaginationHref } from '../../lib/profile/buildProfileNftPaginationHref'

describe('profile NFT collection navigation', () => {
  it('pages the owned collection without losing the minted page or tab', () => {
    const params = new URLSearchParams('tab=nfts&nftMintedPage=3&tag=art')
    expect(
      buildProfileNftPaginationHref('/reader', params, 'nftOwnedPage', 2)
    ).toBe('/reader?tab=nfts&nftMintedPage=3&tag=art&nftOwnedPage=2')
    expect(params.has('nftOwnedPage')).toBe(false)
  })

  it('pages the minted collection without losing the owned page', () => {
    expect(
      buildProfileNftPaginationHref(
        '/reader',
        new URLSearchParams('tab=nfts&nftOwnedPage=2'),
        'nftMintedPage',
        4
      )
    ).toBe('/reader?tab=nfts&nftOwnedPage=2&nftMintedPage=4')
  })

  it('returns to page one without resetting the other collection', () => {
    expect(
      buildProfileNftPaginationHref(
        '/reader',
        new URLSearchParams('tab=nfts&nftOwnedPage=2&nftMintedPage=4'),
        'nftOwnedPage',
        1
      )
    ).toBe('/reader?tab=nfts&nftMintedPage=4')
  })
})
