import { describe, expect, it } from 'vitest'
import { getWriteUrlWithDraftId } from './writeDraftUrl'

describe('getWriteUrlWithDraftId', () => {
  it('returns url with id when missing', () => {
    expect(getWriteUrlWithDraftId('', 'art_123')).toBe('/write?id=art_123')
  })

  it('returns null when id already matches', () => {
    expect(getWriteUrlWithDraftId('id=art_123', 'art_123')).toBeNull()
  })

  it('preserves other query params and updates id', () => {
    expect(getWriteUrlWithDraftId('foo=bar', 'art_456')).toBe(
      '/write?foo=bar&id=art_456'
    )
  })

  it('replaces a different id', () => {
    expect(getWriteUrlWithDraftId('id=old', 'new')).toBe('/write?id=new')
  })
})
