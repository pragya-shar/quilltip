import { describe, expect, it } from 'vitest'
import {
  getVisibleToolbarKeys,
  resolveActiveToolbarKey,
} from './editorToolbarKeys'

describe('getVisibleToolbarKeys', () => {
  it('includes image and youtube on desktop', () => {
    const keys = getVisibleToolbarKeys(false, false)
    expect(keys).toContain('image')
    expect(keys).toContain('youtube')
    expect(keys).not.toContain('more')
  })

  it('uses more menu instead of image on mobile', () => {
    const keys = getVisibleToolbarKeys(true, false)
    expect(keys).toContain('more')
    expect(keys).not.toContain('image')
    expect(keys).not.toContain('youtube')
  })

  it('swaps link insert for link remove when a link is active', () => {
    const keys = getVisibleToolbarKeys(false, true)
    expect(keys).toContain('linkRemove')
    expect(keys).not.toContain('linkInsert')
  })
})

describe('resolveActiveToolbarKey', () => {
  it('keeps active key when it is visible', () => {
    const visible = getVisibleToolbarKeys(false, false)
    expect(resolveActiveToolbarKey('bold', visible)).toBe('bold')
  })

  it('falls back to first visible key when active key is hidden', () => {
    const mobile = getVisibleToolbarKeys(true, false)
    expect(resolveActiveToolbarKey('image', mobile)).toBe(mobile[0])
  })
})
