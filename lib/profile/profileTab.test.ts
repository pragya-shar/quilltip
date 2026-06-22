import { describe, expect, it } from 'vitest'
import {
  buildCurrentProfilePath,
  buildProfileTabHref,
  isLegacyCreatorTab,
  parseProfileTab,
  profileTabUrlIsCanonical,
} from './profileTab'

describe('parseProfileTab', () => {
  it('defaults to articles when tab is missing', () => {
    expect(parseProfileTab(null)).toBe('articles')
  })

  it('accepts articles and nfts tabs', () => {
    expect(parseProfileTab('nfts')).toBe('nfts')
    expect(parseProfileTab('articles')).toBe('articles')
  })

  it('falls back to articles for legacy creator and invalid tab values', () => {
    expect(parseProfileTab('wallet')).toBe('articles')
    expect(parseProfileTab('earnings')).toBe('articles')
    expect(parseProfileTab('stats')).toBe('articles')
    expect(parseProfileTab('invalid')).toBe('articles')
    expect(parseProfileTab('')).toBe('articles')
  })
})

describe('isLegacyCreatorTab', () => {
  it('identifies legacy creator tabs', () => {
    expect(isLegacyCreatorTab('wallet')).toBe(true)
    expect(isLegacyCreatorTab('earnings')).toBe(true)
    expect(isLegacyCreatorTab('stats')).toBe(true)
    expect(isLegacyCreatorTab('nfts')).toBe(false)
    expect(isLegacyCreatorTab(null)).toBe(false)
  })
})

describe('buildProfileTabHref', () => {
  it('sets tab param for nfts', () => {
    const sp = new URLSearchParams('page=2')
    expect(buildProfileTabHref('/alice', sp, 'nfts')).toBe(
      '/alice?page=2&tab=nfts'
    )
  })

  it('removes tab param for articles', () => {
    const sp = new URLSearchParams('tab=nfts&page=2')
    expect(buildProfileTabHref('/alice', sp, 'articles')).toBe('/alice?page=2')
  })

  it('returns pathname only when no query remains', () => {
    const sp = new URLSearchParams('tab=nfts')
    expect(buildProfileTabHref('/bob', sp, 'articles')).toBe('/bob')
  })

  it('preserves NFT pagination params', () => {
    const sp = new URLSearchParams('nftOwnedPage=2&nftMintedPage=3')
    expect(buildProfileTabHref('/bob', sp, 'nfts')).toBe(
      '/bob?nftOwnedPage=2&nftMintedPage=3&tab=nfts'
    )
  })
})

describe('profileTabUrlIsCanonical', () => {
  it('returns true when tab param is absent or valid', () => {
    expect(profileTabUrlIsCanonical(null)).toBe(true)
    expect(profileTabUrlIsCanonical('nfts')).toBe(true)
  })

  it('returns false for legacy creator tabs and articles alias', () => {
    expect(profileTabUrlIsCanonical('wallet')).toBe(false)
    expect(profileTabUrlIsCanonical('earnings')).toBe(false)
    expect(profileTabUrlIsCanonical('stats')).toBe(false)
    expect(profileTabUrlIsCanonical('invalid')).toBe(false)
    expect(profileTabUrlIsCanonical('articles')).toBe(false)
  })
})

describe('buildCurrentProfilePath', () => {
  it('builds pathname with search string', () => {
    expect(
      buildCurrentProfilePath('/alice', new URLSearchParams('tab=nfts'))
    ).toBe('/alice?tab=nfts')
    expect(buildCurrentProfilePath('/alice', new URLSearchParams())).toBe(
      '/alice'
    )
  })
})
