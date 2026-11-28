// @vitest-environment happy-dom
import { act, createElement as h } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  INTENT_TTL_MS,
  clearIntent,
  saveIntent,
  tipIntent,
  type SignInIntent,
} from '@/lib/auth/intent'

// useResumedIntent on a page, with auth and the address stood in: it gives
// back the intent the person signed in with, once, on its own page.

const auth = vi.hoisted(() => ({ isLoading: false, isAuthenticated: false }))
const at = vi.hoisted(() => ({ pathname: '/theo/leave-it-overnight' }))
vi.mock('convex/react', () => ({ useConvexAuth: () => auth }))
vi.mock('next/navigation', () => ({ usePathname: () => at.pathname }))
;(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true

const LINE = { text: 'Leave it overnight.', startOffset: 120, endOffset: 139 }
const intent = tipIntent({
  path: '/theo/leave-it-overnight',
  articleId: 'j57a8b9c0d1e2f3',
  passage: LINE,
  amount: { cents: 100, display: '$1.00', short: '$1' },
  writer: 'Theo Marsh',
})!

async function mount() {
  // A fresh module, as after a full page load.
  vi.resetModules()
  const { useResumedIntent } = await import('@/hooks/auth/useResumedIntent')
  const seen: (SignInIntent | null)[] = []
  function Page() {
    seen.push(useResumedIntent('tip'))
    return null
  }
  const root = createRoot(document.createElement('div'))
  await act(async () => root.render(h(Page)))
  return { seen, root }
}

beforeEach(() => {
  clearIntent()
  auth.isAuthenticated = false
  at.pathname = '/theo/leave-it-overnight'
})
afterEach(() => vi.useRealTimers())

describe('a resumed intent', () => {
  it('comes back once after sign-in, across a full page load', async () => {
    expect(saveIntent(intent)).toBe(true)
    // The page is loaded again, signed out: nothing yet.
    const before = await mount()
    expect(before.seen.at(-1)).toBeNull()
    await act(async () => before.root.unmount())
    // Signed in, on the same page: the intent, once.
    auth.isAuthenticated = true
    const after = await mount()
    expect(after.seen.at(-1)).toEqual(intent)
    await act(async () => after.root.unmount())
    const again = await mount()
    expect(again.seen.at(-1)).toBeNull()
    await act(async () => again.root.unmount())
  })

  it('does nothing on another page, and leaves the intent there', async () => {
    saveIntent(intent)
    auth.isAuthenticated = true
    at.pathname = '/shelf'
    const other = await mount()
    expect(other.seen.at(-1)).toBeNull()
    await act(async () => other.root.unmount())
    at.pathname = '/theo/leave-it-overnight'
    const own = await mount()
    expect(own.seen.at(-1)).toEqual(intent)
    await act(async () => own.root.unmount())
  })

  it('does nothing once expired', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(0)
    saveIntent(intent)
    vi.setSystemTime(INTENT_TTL_MS + 1)
    auth.isAuthenticated = true
    const late = await mount()
    expect(late.seen.at(-1)).toBeNull()
    await act(async () => late.root.unmount())
  })
})
