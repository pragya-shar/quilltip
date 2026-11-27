import { describe, expect, it, vi } from 'vitest'
import {
  READ_LIMIT_MS,
  ReadTimeout,
  retryHrefFor,
  withinReadLimit,
} from '@/shell/public/boundedRead'

describe('withinReadLimit', () => {
  it('uses the public read limit of D21', () => {
    expect(READ_LIMIT_MS).toBe(1500)
  })

  it('settles with a read that answers in time', async () => {
    await expect(withinReadLimit(Promise.resolve('ok'), 50)).resolves.toBe('ok')
  })

  it('passes a failed read on', async () => {
    await expect(
      withinReadLimit(Promise.reject(new Error('down')), 50)
    ).rejects.toThrow('down')
  })

  it('gives up after the limit, and a later failure goes nowhere', async () => {
    vi.useFakeTimers()
    try {
      let fail!: (error: Error) => void
      const slow = new Promise<string>((_, reject) => (fail = reject))
      const raced = withinReadLimit(slow, 100)
      vi.advanceTimersByTime(100)
      await expect(raced).rejects.toBeInstanceOf(ReadTimeout)
      fail(new Error('late'))
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('retryHrefFor', () => {
  it('keeps the path and every query value', () => {
    expect(retryHrefFor('/noor/a-story', {})).toBe('/noor/a-story')
    expect(
      retryHrefFor('/noor/a-story', {
        line: '3',
        tag: ['a', 'b'],
        none: undefined,
      })
    ).toBe('/noor/a-story?line=3&tag=a&tag=b')
  })
})
