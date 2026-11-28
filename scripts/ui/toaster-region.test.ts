// @vitest-environment happy-dom
/**
 * The site's toaster loads after the page (components/providers), so its
 * live region is created after hydration. A screen reader announces a change
 * inside a live region that already exists; a region created together with
 * its first message may not be announced (review of #503). The Toaster holds
 * every toast until its empty region has existed for REGION_READY_FRAMES
 * frames, so a toast raised before it loaded, or in the same moment, goes into
 * a region that is already there.
 */
import { readFileSync } from 'fs'
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { toast } from 'sonner'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { REGION_READY_FRAMES, Toaster } from '@/components/ui/sonner'

const g = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
g.IS_REACT_ACT_ENVIRONMENT = true

let root: Root | null = null
let host: HTMLElement

/** What was added to the page, in order: the region, then each message. */
let added: string[] = []
let observer: MutationObserver

beforeEach(() => {
  vi.useFakeTimers({
    toFake: [
      'setTimeout',
      'clearTimeout',
      'requestAnimationFrame',
      'cancelAnimationFrame',
      'Date',
    ],
  })
  host = document.createElement('div')
  document.body.append(host)
  added = []
  observer = new MutationObserver(record)
  observer.observe(document.body, { childList: true, subtree: true })
})

afterEach(() => {
  observer.disconnect()
  act(() => root?.unmount())
  root = null
  host.remove()
  toast.dismiss()
  vi.runOnlyPendingTimers()
  vi.useRealTimers()
})

/** Notes what the page gained, in the order the browser recorded it. */
const counted = new WeakSet<Element>()
function record(records: MutationRecord[]) {
  const note = (element: Element, what: string) => {
    if (counted.has(element)) return
    counted.add(element)
    added.push(what)
  }
  for (const entry of records)
    for (const node of entry.addedNodes) {
      if (!(node instanceof HTMLElement)) continue
      if (node.matches('section[aria-live]')) note(node, 'region')
      for (const item of node.matches('[data-sonner-toast]')
        ? [node]
        : node.querySelectorAll('[data-sonner-toast]'))
        note(item, `toast: ${item.textContent}`)
    }
}

/** The additions so far (records are delivered in a microtask otherwise). */
function additions() {
  record(observer.takeRecords())
  return added
}

const region = () => document.querySelector('section[aria-live="polite"]')
const shows = (text: string) => region()?.textContent?.includes(text) ?? false

function mount() {
  root = createRoot(host)
  act(() => root!.render(createElement(Toaster)))
}

/** One animation frame, then the timers sonner sets to add a toast. */
function frame() {
  act(() => {
    vi.advanceTimersToNextFrame()
    vi.advanceTimersByTime(0)
  })
}

describe('the toaster after a lazy load', () => {
  it('waits at least two frames: one for the region, one for the accessibility tree', () => {
    expect(REGION_READY_FRAMES).toBeGreaterThanOrEqual(2)
  })

  it('shows a toast raised before it loaded only after its empty region existed', () => {
    act(() => {
      toast('Profile saved')
    })
    mount()
    expect(region()).not.toBeNull()
    expect(shows('Profile saved')).toBe(false)
    for (let i = 1; i < REGION_READY_FRAMES; i++) {
      frame()
      expect(shows('Profile saved'), `frame ${i}`).toBe(false)
    }
    frame()
    expect(shows('Profile saved')).toBe(true)
    expect(additions()).toEqual(['region', 'toast: Profile saved'])
  })

  it('holds a toast raised in the same moment as it mounts', () => {
    root = createRoot(host)
    act(() => {
      root!.render(createElement(Toaster))
      toast('Bookmark saved')
    })
    expect(region()).not.toBeNull()
    expect(shows('Bookmark saved')).toBe(false)
    for (let i = 1; i < REGION_READY_FRAMES; i++) {
      frame()
      expect(shows('Bookmark saved'), `frame ${i}`).toBe(false)
    }
    frame()
    expect(shows('Bookmark saved')).toBe(true)
    expect(additions()[0]).toBe('region')
  })

  it('shows a toast raised once the region is ready right away', () => {
    mount()
    for (let i = 0; i < REGION_READY_FRAMES; i++) frame()
    act(() => {
      toast('Highlight saved')
      vi.advanceTimersByTime(0)
    })
    expect(shows('Highlight saved')).toBe(true)
    expect(additions()).toEqual(['region', 'toast: Highlight saved'])
  })

  it('keeps the live region polite, as the notifications test expects', () => {
    mount()
    expect(region()?.getAttribute('aria-label')).toMatch(/^Notifications/)
    expect(region()?.getAttribute('aria-live')).toBe('polite')
  })
})

describe('Providers', () => {
  it('loads the toaster with next/dynamic and no server render', () => {
    const source = readFileSync('components/providers/Providers.tsx', 'utf8')
    expect(source).not.toMatch(/from '@\/components\/ui\/sonner'/)
    expect(source).toMatch(
      /dynamic\(\s*\(\) => import\('@\/components\/ui\/sonner'\)[\s\S]*?ssr: false/
    )
  })
})
