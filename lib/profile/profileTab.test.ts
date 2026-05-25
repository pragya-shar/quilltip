import { describe, expect, it } from 'vitest'
import {
  buildCurrentProfilePath,
  buildProfileTabHref,
  parseProfileTab,
  profileTabUrlIsCanonical,
} from './profileTab'

describe('parseProfileTab', () => {
  it('defaults to articles when tab is missing', () => {
    expect(parseProfileTab(null, true)).toBe('articles')
    expect(parseProfileTab(null, false)).toBe('articles')
  })

  it('accepts public tabs for any profile', () => {
    expect(parseProfileTab('nfts', false)).toBe('nfts')
    expect(parseProfileTab('wallet', false)).toBe('wallet')
  })

  it('accepts earnings and stats only on own profile', () => {
    expect(parseProfileTab('earnings', true)).toBe('earnings')
    expect(parseProfileTab('stats', true)).toBe('stats')
    expect(parseProfileTab('earnings', false)).toBe('articles')
    expect(parseProfileTab('stats', false)).toBe('articles')
  })

  it('falls back to articles for invalid tab values', () => {
    expect(parseProfileTab('invalid', true)).toBe('articles')
    expect(parseProfileTab('', true)).toBe('articles')
  })
})

describe('buildProfileTabHref', () => {
  it('sets tab param for non-articles tabs', () => {
    const sp = new URLSearchParams('page=2')
    expect(buildProfileTabHref('/alice', sp, 'earnings')).toBe(
      '/alice?page=2&tab=earnings'
    )
  })

  it('removes tab param for articles', () => {
    const sp = new URLSearchParams('tab=wallet&page=2')
    expect(buildProfileTabHref('/alice', sp, 'articles')).toBe('/alice?page=2')
  })

  it('returns pathname only when no query remains', () => {
    const sp = new URLSearchParams('tab=earnings')
    expect(buildProfileTabHref('/bob', sp, 'articles')).toBe('/bob')
  })

  it('preserves NFT pagination params', () => {
    const sp = new URLSearchParams('nftOwnedPage=2&nftMintedPage=3')
    expect(buildProfileTabHref('/bob', sp, 'wallet')).toBe(
      '/bob?nftOwnedPage=2&nftMintedPage=3&tab=wallet'
    )
  })
})

describe('profileTabUrlIsCanonical', () => {
  it('returns true when tab param is absent or valid', () => {
    expect(profileTabUrlIsCanonical(null, false)).toBe(true)
    expect(profileTabUrlIsCanonical('wallet', false)).toBe(true)
    expect(profileTabUrlIsCanonical('earnings', true)).toBe(true)
  })

  it('returns false for invalid or disallowed tab params', () => {
    expect(profileTabUrlIsCanonical('invalid', true)).toBe(false)
    expect(profileTabUrlIsCanonical('earnings', false)).toBe(false)
    expect(profileTabUrlIsCanonical('stats', false)).toBe(false)
    expect(profileTabUrlIsCanonical('articles', true)).toBe(false)
  })
})

describe('buildCurrentProfilePath', () => {
  it('builds pathname with search string', () => {
    expect(
      buildCurrentProfilePath('/alice', new URLSearchParams('tab=wallet'))
    ).toBe('/alice?tab=wallet')
    expect(buildCurrentProfilePath('/alice', new URLSearchParams())).toBe(
      '/alice'
    )
  })
})
