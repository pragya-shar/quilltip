import { describe, expect, it } from 'vitest'
import {
  PERF_ROUTE_PACKAGES,
  SURFACE_FIRST_LOAD,
  SURFACE_FONT_FALLBACK,
  SURFACE_PAGE_LOAD,
} from './routes'
import { FIRST_LOAD_BUDGET_KB, FIRST_LOAD_ROUTES } from './first-load'

describe('measured routes from scripts/perf/routes', () => {
  it('has one file per package', () => {
    expect(Object.keys(PERF_ROUTE_PACKAGES).sort()).toEqual([
      'foundation',
      'ops',
      'pocket',
      'read',
      'resources',
      'search',
      'shelf',
      'signin',
      'today',
      'write',
      'writer',
      'you',
    ])
  })

  it('gives each first-load route a budget within the plan (170 KB at most)', () => {
    const routes = SURFACE_FIRST_LOAD.map((e) => e.route)
    expect(new Set(routes).size).toBe(routes.length)
    for (const entry of SURFACE_FIRST_LOAD) {
      expect(entry.route).toMatch(/^\//)
      expect(entry.budgetKb).toBeGreaterThan(0)
      expect(entry.budgetKb).toBeLessThanOrEqual(170)
      expect(FIRST_LOAD_ROUTES).toContain(entry.route)
      expect(FIRST_LOAD_BUDGET_KB[entry.route]).toBe(entry.budgetKb)
    }
  })

  it('names page-load and font routes once, at real paths', () => {
    for (const list of [SURFACE_PAGE_LOAD, SURFACE_FONT_FALLBACK]) {
      const names = list.map((e) => e.name)
      expect(new Set(names).size).toBe(names.length)
      for (const entry of list) expect(entry.path).toMatch(/^\/(?!\/)/)
    }
    for (const entry of SURFACE_PAGE_LOAD)
      for (const kb of Object.values(entry.budget))
        expect(kb).toBeGreaterThan(0)
  })

  it('keeps the shell reading page measured, at the public limits', () => {
    expect(FIRST_LOAD_BUDGET_KB['/system/reading']).toBe(150)
    const reading = SURFACE_PAGE_LOAD.find((e) => e.path === '/system/reading')
    expect(reading?.budget).toMatchObject({ cls: 0.05, lcpMs: 2000 })
  })
})
