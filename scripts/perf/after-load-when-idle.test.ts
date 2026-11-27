import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { afterLoadWhenIdle } from '@/lib/scheduling/afterLoadWhenIdle'

type Listener = () => void

/** A minimal window and document: load listeners and an optional idle API. */
function fakeBrowser({
  readyState,
  idle,
}: {
  readyState: DocumentReadyState
  idle: boolean
}) {
  const listeners = new Map<string, Listener>()
  const idleCallbacks = new Map<number, Listener>()
  let nextId = 1
  const win: Record<string, unknown> = {
    addEventListener: (type: string, listener: Listener) =>
      listeners.set(type, listener),
    removeEventListener: (type: string, listener: Listener) => {
      if (listeners.get(type) === listener) listeners.delete(type)
    },
  }
  if (idle) {
    win.requestIdleCallback = (callback: Listener) => {
      const id = nextId++
      idleCallbacks.set(id, callback)
      return id
    }
    win.cancelIdleCallback = (id: number) => idleCallbacks.delete(id)
  }
  vi.stubGlobal('window', win)
  vi.stubGlobal('document', { readyState })
  return {
    load: () => listeners.get('load')?.(),
    hasLoadListener: () => listeners.has('load'),
    runIdle: () => {
      for (const [id, callback] of idleCallbacks) {
        idleCallbacks.delete(id)
        callback()
      }
    },
    pendingIdle: () => idleCallbacks.size,
  }
}

beforeEach(() => {
  vi.useFakeTimers()
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('afterLoadWhenIdle', () => {
  it('with requestIdleCallback, waits for load and then for idle time', () => {
    const browser = fakeBrowser({ readyState: 'loading', idle: true })
    const task = vi.fn()
    afterLoadWhenIdle(task)
    expect(browser.pendingIdle()).toBe(0)
    browser.load()
    expect(task).not.toHaveBeenCalled()
    browser.runIdle()
    expect(task).toHaveBeenCalledTimes(1)
  })

  it('with requestIdleCallback, after load, schedules at once', () => {
    const browser = fakeBrowser({ readyState: 'complete', idle: true })
    const task = vi.fn()
    afterLoadWhenIdle(task)
    expect(browser.hasLoadListener()).toBe(false)
    browser.runIdle()
    expect(task).toHaveBeenCalledTimes(1)
  })

  it('without requestIdleCallback (Safari), runs after load on a timer', () => {
    const browser = fakeBrowser({ readyState: 'loading', idle: false })
    const task = vi.fn()
    afterLoadWhenIdle(task)
    vi.advanceTimersByTime(1000)
    expect(task).not.toHaveBeenCalled()
    browser.load()
    vi.advanceTimersByTime(199)
    expect(task).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(task).toHaveBeenCalledTimes(1)
  })

  it('without requestIdleCallback, after load, runs on a timer', () => {
    fakeBrowser({ readyState: 'complete', idle: false })
    const task = vi.fn()
    afterLoadWhenIdle(task)
    vi.advanceTimersByTime(200)
    expect(task).toHaveBeenCalledTimes(1)
  })

  it('cleanup cancels the task in every state', () => {
    const before = fakeBrowser({ readyState: 'loading', idle: true })
    const first = vi.fn()
    afterLoadWhenIdle(first)()
    expect(before.hasLoadListener()).toBe(false)
    before.load()
    before.runIdle()
    expect(first).not.toHaveBeenCalled()

    const idle = fakeBrowser({ readyState: 'complete', idle: true })
    const second = vi.fn()
    afterLoadWhenIdle(second)()
    expect(idle.pendingIdle()).toBe(0)
    expect(second).not.toHaveBeenCalled()

    fakeBrowser({ readyState: 'complete', idle: false })
    const third = vi.fn()
    afterLoadWhenIdle(third)()
    vi.advanceTimersByTime(1000)
    expect(third).not.toHaveBeenCalled()
  })
})
