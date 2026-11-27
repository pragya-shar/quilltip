import { describe, expect, it } from 'vitest'
import {
  NAVIGATION,
  destinationsFor,
  isActive,
  type Destination,
} from '@/shell/navigation'

describe('navigation config', () => {
  it('has unique ids and labels', () => {
    const ids = NAVIGATION.destinations.map((d) => d.id)
    const labels = NAVIGATION.destinations.map((d) => d.label)
    expect(new Set(ids).size).toBe(ids.length)
    expect(new Set(labels).size).toBe(labels.length)
  })

  it('links only to paths on this site', () => {
    for (const d of NAVIGATION.destinations) {
      expect(d.href, d.id).toMatch(/^\/(?!\/)/)
    }
  })

  it('keeps the phone bar to five places or fewer, and at least two', () => {
    const phone = destinationsFor(NAVIGATION, 'phone')
    expect(phone.length).toBeGreaterThanOrEqual(2)
    expect(phone.length).toBeLessThanOrEqual(5)
  })

  it('puts every destination somewhere', () => {
    for (const d of NAVIGATION.destinations)
      expect(d.on.length).toBeGreaterThan(0)
  })

  it('marks at most one destination active for any path, per place', () => {
    const paths = [
      '/',
      '/articles',
      '/write',
      '/dashboard/tab',
      '/dashboard/stats',
      '/settings/profile',
      '/pragya/a-story',
    ]
    for (const path of paths) {
      for (const place of ['phone', 'desktop'] as const) {
        const active = destinationsFor(NAVIGATION, place).filter((d) =>
          isActive(d, path)
        )
        expect(active.length, `${place} ${path}`).toBeLessThanOrEqual(1)
      }
    }
  })
})

describe('isActive', () => {
  const home: Destination = {
    id: 'h',
    label: 'Home',
    href: '/',
    icon: [],
    on: ['phone'],
    match: 'exact',
  }
  const write: Destination = {
    ...home,
    id: 'w',
    href: '/write',
    match: 'prefix',
  }

  it('matches the home only on the home', () => {
    expect(isActive(home, '/')).toBe(true)
    expect(isActive(home, '/write')).toBe(false)
  })

  it('matches a prefix on nested paths, not on lookalikes', () => {
    expect(isActive(write, '/write')).toBe(true)
    expect(isActive(write, '/write/draft-1')).toBe(true)
    expect(isActive(write, '/write/')).toBe(true)
    expect(isActive(write, '/writers')).toBe(false)
  })

  it('matches an alias', () => {
    expect(isActive({ ...home, also: ['/articles'] }, '/articles')).toBe(true)
  })
})
