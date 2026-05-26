import { describe, expect, it } from 'vitest'
import { buildArticlePublicPath, buildArticlePublicUrl } from './public-url'

describe('buildArticlePublicPath', () => {
  it('builds /{username}/{slug}', () => {
    expect(buildArticlePublicPath('alice', 'hello-world')).toBe(
      '/alice/hello-world'
    )
  })
})

describe('buildArticlePublicUrl', () => {
  it('builds an absolute URL and trims trailing slashes', () => {
    expect(buildArticlePublicUrl('https://example.com', 'alice', 'hello-world'))
      .toBe('https://example.com/alice/hello-world')
    expect(buildArticlePublicUrl('https://example.com/', 'alice', 'hello-world'))
      .toBe('https://example.com/alice/hello-world')
  })
})

