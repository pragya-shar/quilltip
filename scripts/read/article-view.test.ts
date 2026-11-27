import { describe, expect, it } from 'vitest'
import { articleViewStatus, tipsByHighlight } from '@/hooks/read/useArticleView'

const server = { _id: 'a1', updatedAt: 100, contentVersion: 3 }

describe('the server copy against the live article', () => {
  it('is the server copy until the live answer arrives', () => {
    expect(articleViewStatus(server, undefined)).toBe('server')
  })
  it('is current when nothing changed', () => {
    expect(articleViewStatus(server, { ...server })).toBe('current')
  })
  it('is changed after an edit', () => {
    expect(articleViewStatus(server, { ...server, contentVersion: 4 })).toBe(
      'changed'
    )
    expect(articleViewStatus(server, { ...server, updatedAt: 200 })).toBe(
      'changed'
    )
  })
  it('is gone when unpublished, deleted or replaced', () => {
    expect(articleViewStatus(server, null)).toBe('gone')
    expect(articleViewStatus(server, { ...server, _id: 'a2' })).toBe('gone')
  })
})

describe('tips by highlight', () => {
  it('keys counts and dollars by highlight', () => {
    expect(
      tipsByHighlight({
        topHighlights: [
          { highlightId: 'h1', tipCount: 3, totalAmountCents: 250 },
        ],
      })
    ).toEqual({ h1: { count: 3, totalUsd: 2.5 } })
  })
  it('is empty with no stats', () => {
    expect(tipsByHighlight(undefined)).toEqual({})
    expect(tipsByHighlight(null)).toEqual({})
  })
})
