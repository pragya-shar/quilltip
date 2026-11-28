import { describe, expect, it } from 'vitest'
import { createMountCounter } from '@/system/onlyOne'

describe('parts of the page there is one of', () => {
  it('reports a second mount, and not a remount after the first went', () => {
    const reports: string[] = []
    const counter = createMountCounter((message) => reports.push(message))
    const first = counter.mount('ToastRegion')
    expect(reports).toEqual([])
    // StrictMode: mounted, unmounted and mounted again.
    first()
    const again = counter.mount('ToastRegion')
    expect(reports).toEqual([])
    counter.mount('Dock')
    expect(reports).toEqual([])
    counter.mount('ToastRegion')
    expect(reports).toHaveLength(1)
    expect(reports[0]).toMatch(/^ToastRegion is mounted 2 times/)
    again()
  })
})
