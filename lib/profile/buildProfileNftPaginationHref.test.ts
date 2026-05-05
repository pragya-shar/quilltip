import { describe, expect, it } from 'vitest'
import { buildProfileNftPaginationHref } from './buildProfileNftPaginationHref'

describe('buildProfileNftPaginationHref', () => {
  it('sets nftOwnedPage and preserves other params', () => {
    const sp = new URLSearchParams('page=2&nftMintedPage=3')
    expect(buildProfileNftPaginationHref('/alice', sp, 'nftOwnedPage', 2)).toBe(
      '/alice?page=2&nftMintedPage=3&nftOwnedPage=2'
    )
  })

  it('removes nftOwnedPage when page is 1', () => {
    const sp = new URLSearchParams('nftOwnedPage=2&nftMintedPage=3')
    expect(buildProfileNftPaginationHref('/alice', sp, 'nftOwnedPage', 1)).toBe(
      '/alice?nftMintedPage=3'
    )
  })

  it('returns pathname only when no query remains', () => {
    const sp = new URLSearchParams('nftOwnedPage=2')
    expect(buildProfileNftPaginationHref('/bob', sp, 'nftOwnedPage', 1)).toBe(
      '/bob'
    )
  })

  it('updates nftMintedPage without dropping nftOwnedPage', () => {
    const sp = new URLSearchParams('nftOwnedPage=2&nftMintedPage=1')
    expect(buildProfileNftPaginationHref('/bob', sp, 'nftMintedPage', 4)).toBe(
      '/bob?nftOwnedPage=2&nftMintedPage=4'
    )
  })
})
