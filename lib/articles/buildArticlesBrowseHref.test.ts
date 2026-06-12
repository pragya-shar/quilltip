import { describe, expect, it } from 'vitest'
import {
  buildArticlesBrowseHref,
  pickArticlesBrowseParams,
} from './buildArticlesBrowseHref'

describe('pickArticlesBrowseParams', () => {
  it('keeps only browse query keys', () => {
    const source = new URLSearchParams(
      'page=2&tag=rust&search=foo&author=alice&view=trending&sort=oldest&nftOwnedPage=3&tab=earnings'
    )
    const picked = pickArticlesBrowseParams(source)
    expect(Object.fromEntries(picked)).toEqual({
      tag: 'rust',
      page: '2',
      search: 'foo',
      author: 'alice',
      view: 'trending',
      sort: 'oldest',
    })
  })

  it('returns empty when no browse keys are present', () => {
    const source = new URLSearchParams('nftOwnedPage=3&nftMintedPage=1')
    expect(pickArticlesBrowseParams(source).toString()).toBe('')
  })
})

describe('buildArticlesBrowseHref', () => {
  it('strips profile params and sets tag with page 1', () => {
    const source = new URLSearchParams('page=2&nftOwnedPage=3&nftMintedPage=1')
    expect(
      buildArticlesBrowseHref({
        tag: 'rust',
        page: 1,
        sourceParams: source,
      })
    ).toBe('/articles?tag=rust')
  })

  it('preserves search and replaces tag when building from articles browse', () => {
    const source = new URLSearchParams('search=foo&tag=old&page=3')
    expect(
      buildArticlesBrowseHref({
        tag: 'new',
        page: 1,
        sourceParams: source,
      })
    ).toBe('/articles?tag=new&search=foo')
  })

  it('sets author and overrides picked author from source', () => {
    const source = new URLSearchParams('author=other&page=2')
    expect(
      buildArticlesBrowseHref({
        tag: 'rust',
        page: 1,
        author: 'alice',
        sourceParams: source,
      })
    ).toBe('/articles?author=alice&tag=rust')
  })

  it('returns /articles when clearing all filters', () => {
    expect(
      buildArticlesBrowseHref({
        tag: '',
        search: '',
        author: '',
        page: 1,
        sourceParams: new URLSearchParams('tag=old&search=x'),
      })
    ).toBe('/articles')
  })

  it('sets page greater than 1', () => {
    expect(
      buildArticlesBrowseHref({
        tag: 'rust',
        page: 2,
      })
    ).toBe('/articles?tag=rust&page=2')
  })

  it('sets view and sort when non-default', () => {
    expect(
      buildArticlesBrowseHref({
        view: 'trending',
        sort: 'oldest',
        page: 1,
      })
    ).toBe('/articles?view=trending&sort=oldest')
  })

  it('omits default view and sort from href', () => {
    expect(
      buildArticlesBrowseHref({
        view: 'latest',
        sort: 'newest',
        page: 1,
      })
    ).toBe('/articles')
  })
})
