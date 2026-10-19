/** @vitest-environment jsdom */
import { renderHook } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { useAuthReturnPath } from './useAuthReturnPath'
const state = vi.hoisted(() => ({ query: '' }))
vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(state.query),
}))
describe('auth destination compatibility', () => {
  it.each([
    ['next=%2Flibrary', '/library'],
    ['redirect=%2Fdashboard%2Fwallet', '/dashboard/wallet'],
    [
      'returnTo=%2Fmaya%2Fstory%3Fbookmark%3D1%26highlight%3Dh1%23passage',
      '/maya/story?bookmark=1&highlight=h1#passage',
    ],
    ['redirect=https%3A%2F%2Fevil.test&returnTo=%2Flibrary', '/library'],
    ['redirect=%2F%09%2Fevil.test', '/'],
    ['next=%2F%5Cevil.test', '/'],
  ])('safely resolves %s', (query, expected) => {
    state.query = query
    expect(renderHook(() => useAuthReturnPath()).result.current).toBe(expected)
  })
})
