import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { loadArticle } from '@/components/read/loadArticle'
import { READ_LIMIT_MS, withinReadLimit } from '@/shell/public/boundedRead'

const never = <T>() => new Promise<T>(() => {})
const after = <T>(ms: number, value: T) =>
  new Promise<T>((resolve) => setTimeout(() => resolve(value), ms))

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

/** Runs `load` and says how long it took on the fake clock. */
async function timed<T>(load: Promise<T>) {
  const start = Date.now()
  let settled = false
  const done = () => {
    settled = true
  }
  void load.then(done, done)
  while (!settled) await vi.advanceTimersByTimeAsync(50)
  return { value: await load, ms: Date.now() - start }
}

describe('the article read has a time limit (D21)', () => {
  it('a fast read renders the article', async () => {
    const { value, ms } = await timed(
      loadArticle('tomas', 'ledger', {
        article: () => after(100, { title: 'Ledger' }),
        moved: () => never(),
      })
    )
    expect(value).toEqual({ kind: 'found', article: { title: 'Ledger' } })
    expect(ms).toBeLessThan(READ_LIMIT_MS)
  })

  it('a silent backend is unreachable within the limit, not missing', async () => {
    const { value, ms } = await timed(
      loadArticle('tomas', 'ledger', { article: never, moved: never })
    )
    expect(value).toEqual({ kind: 'unreachable' })
    expect(ms).toBeLessThanOrEqual(READ_LIMIT_MS + 50)
  })

  it('a failed read (undefined) is unreachable', async () => {
    const { value } = await timed(
      loadArticle('tomas', 'ledger', {
        article: async () => undefined,
        moved: never,
      })
    )
    expect(value).toEqual({ kind: 'unreachable' })
  })

  it('a missing article is a 404, or a redirect for a moved handle', async () => {
    const missing = await timed(
      loadArticle('tomas', 'ledger', {
        article: async () => null,
        moved: async () => null,
      })
    )
    expect(missing.value).toEqual({ kind: 'missing' })
    const moved = await timed(
      loadArticle('tomas', 'ledger', {
        article: async () => null,
        moved: async () => '/tomas-r/ledger',
      })
    )
    expect(moved.value).toEqual({ kind: 'moved', to: '/tomas-r/ledger' })
  })

  it('a silent moved-handle lookup is unreachable, within two limits', async () => {
    const { value, ms } = await timed(
      loadArticle('tomas', 'ledger', {
        article: () => after(READ_LIMIT_MS - 100, null),
        moved: never,
      })
    )
    expect(value).toEqual({ kind: 'unreachable' })
    expect(ms).toBeLessThanOrEqual(2 * READ_LIMIT_MS + 50)
  })

  it('a read that fails after the limit leaves nothing unhandled', async () => {
    const late = new Promise((_, reject) =>
      setTimeout(() => reject(new Error('late failure')), 300)
    )
    await expect(timed(withinReadLimit(late, 100))).rejects.toThrow(
      'longer than 100 ms'
    )
    await vi.advanceTimersByTimeAsync(400)
  })
})
