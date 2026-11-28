import { beforeEach, expect, test, vi } from 'vitest'

// readToday with the cache and the backend replaced: which reads go through
// the cache, which go straight to the backend, and that a failure is
// returned as "unreachable" (and so never stored by the cache).
const calls = vi.hoisted(() => ({
  cached: [] as unknown[][],
  direct: [] as unknown[][],
  fail: false,
}))

vi.mock('next/cache', () => ({
  unstable_cache:
    (fn: (...args: unknown[]) => Promise<unknown>) =>
    (...args: unknown[]) => {
      calls.cached.push(args)
      return fn(...args)
    },
}))

vi.mock('convex/nextjs', () => ({
  fetchQuery: async (_ref: unknown, args: unknown) => {
    calls.direct.push([args])
    if (calls.fail) throw new Error('backend down')
    return {
      window: { index: 0, startsAt: 0, endsAt: 1 },
      opening: null,
      more: [],
    }
  },
}))

const { readToday } = await import('../../components/today/data')

beforeEach(() => {
  calls.cached = []
  calls.direct = []
  calls.fail = false
})

const NOW = 1_800_000_000_000

test('a reader with no skip list reads through the cache, keyed by the minute', async () => {
  const data = await readToday(NOW, [])
  expect(data.status).toBe('ready')
  expect(calls.cached).toEqual([[Math.floor(NOW / 60_000)]])
  expect(calls.direct).toEqual([[{ at: Math.floor(NOW / 60_000) * 60_000 }]])
})

test('a skip list never uses the cache', async () => {
  const data = await readToday(NOW, ['k57a1b2c3d4e5f6g7h8'])
  expect(data.status).toBe('ready')
  expect(calls.cached).toEqual([])
  expect(calls.direct).toEqual([
    [
      {
        at: Math.floor(NOW / 60_000) * 60_000,
        exclude: ['k57a1b2c3d4e5f6g7h8'],
      },
    ],
  ])
})

test('a failed read is unreachable', async () => {
  calls.fail = true
  expect(await readToday(NOW, [])).toEqual({ status: 'unreachable' })
  expect(await readToday(NOW, ['k57a1b2c3d4e5f6g7h8'])).toEqual({
    status: 'unreachable',
  })
})
