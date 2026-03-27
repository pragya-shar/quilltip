import { describe, expect, it } from 'vitest'

import { parseWikimediaFileTitleFromPageUrl } from './wikimediaFileUrl'

describe('parseWikimediaFileTitleFromPageUrl', () => {
  it('parses English Wikipedia File: page URL', () => {
    expect(
      parseWikimediaFileTitleFromPageUrl(
        'https://en.wikipedia.org/wiki/File:Mercedes-Benz_AMG_Vision_Gran_Turismo_DSC_8431.jpg'
      )
    ).toBe('File:Mercedes-Benz AMG Vision Gran Turismo DSC 8431.jpg')
  })

  it('parses Commons File: page URL', () => {
    expect(
      parseWikimediaFileTitleFromPageUrl(
        'https://commons.wikimedia.org/wiki/File:Example.png'
      )
    ).toBe('File:Example.png')
  })

  it('returns null for article URLs', () => {
    expect(
      parseWikimediaFileTitleFromPageUrl(
        'https://en.wikipedia.org/wiki/Mercedes-Benz'
      )
    ).toBeNull()
  })

  it('returns null for non-Wikimedia hosts', () => {
    expect(
      parseWikimediaFileTitleFromPageUrl('https://example.com/image.jpg')
    ).toBeNull()
  })
})
