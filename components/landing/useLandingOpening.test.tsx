/** @vitest-environment jsdom */
import { act, renderHook } from '@testing-library/react'
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { useLandingOpening } from './useLandingOpening'

describe('landing opening policy', () => {
  beforeEach(() => {
    sessionStorage.clear()
    window.history.replaceState(null, '', '/')
    vi.stubGlobal(
      'matchMedia',
      vi.fn(() => ({
        matches: false,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      }))
    )
    vi.spyOn(performance, 'getEntriesByType').mockReturnValue([])
    Element.prototype.animate = vi.fn()
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })
  it('opens once per session and preserves the completed state on remount', () => {
    const first = renderHook(useLandingOpening)
    expect(first.result.current.active).toBe(true)
    act(() => first.result.current.finish())
    expect(first.result.current.active).toBe(false)
    first.unmount()
    expect(renderHook(useLandingOpening).result.current.active).toBe(false)
  })
  it('skips the opening for reduced motion and anchor navigation', () => {
    vi.mocked(window.matchMedia).mockReturnValue({
      matches: true,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    } as unknown as MediaQueryList)
    const reduced = renderHook(useLandingOpening)
    expect(reduced.result.current.active).toBe(false)
    reduced.unmount()
    vi.mocked(window.matchMedia).mockReturnValue({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    } as unknown as MediaQueryList)
    window.history.replaceState(null, '', '/#faq')
    expect(renderHook(useLandingOpening).result.current.active).toBe(false)
  })
  it('continues to work when session storage is unavailable', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    const { result } = renderHook(useLandingOpening)
    expect(result.current.active).toBe(true)
    act(() => result.current.finish())
    expect(result.current.active).toBe(false)
  })
})
