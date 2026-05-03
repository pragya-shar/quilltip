/** @vitest-environment jsdom */
import { renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { usePaginationTransition } from './usePaginationTransition'

describe('usePaginationTransition', () => {
  it('reports no data and not paginating on first render with undefined', () => {
    const { result } = renderHook(() =>
      usePaginationTransition<string>(undefined)
    )

    expect(result.current.data).toBeUndefined()
    expect(result.current.isPaginating).toBe(false)
  })

  it('returns the resolved value with isPaginating=false', () => {
    const { result, rerender } = renderHook(
      ({ value }: { value: string | undefined }) =>
        usePaginationTransition(value),
      { initialProps: { value: undefined as string | undefined } }
    )

    rerender({ value: 'page-1' })

    expect(result.current.data).toBe('page-1')
    expect(result.current.isPaginating).toBe(false)
  })

  it('keeps the previous value and flips isPaginating when current goes back to undefined', () => {
    const { result, rerender } = renderHook(
      ({ value }: { value: string | undefined }) =>
        usePaginationTransition(value),
      { initialProps: { value: 'page-1' as string | undefined } }
    )

    rerender({ value: undefined })

    expect(result.current.data).toBe('page-1')
    expect(result.current.isPaginating).toBe(true)
  })

  it('updates to the new value and clears isPaginating once the new query resolves', () => {
    const { result, rerender } = renderHook(
      ({ value }: { value: string | undefined }) =>
        usePaginationTransition(value),
      { initialProps: { value: 'page-1' as string | undefined } }
    )

    rerender({ value: undefined })
    expect(result.current.data).toBe('page-1')
    expect(result.current.isPaginating).toBe(true)

    rerender({ value: 'page-2' })

    expect(result.current.data).toBe('page-2')
    expect(result.current.isPaginating).toBe(false)
  })
})
