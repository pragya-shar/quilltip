import { describe, it, expect, vi, afterEach } from 'vitest'
import { mutationWithTimeout } from './convexMutationWithTimeout'

describe('mutationWithTimeout', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('resolves when the mutation completes first', async () => {
    await expect(mutationWithTimeout(Promise.resolve('ok'))).resolves.toBe('ok')
  })

  it('rejects when the mutation exceeds the timeout', async () => {
    vi.useFakeTimers()
    const pending = new Promise<string>(() => {})
    const result = mutationWithTimeout(pending, {
      timeoutMs: 1000,
      message: 'timed out',
    })
    const expectation = expect(result).rejects.toThrow('timed out')
    await vi.advanceTimersByTimeAsync(1000)
    await expectation
  })
})
