import { describe, expect, it } from 'vitest'
import {
  PERF_ROUTE_PACKAGES,
  SURFACE_FIRST_LOAD,
  SURFACE_FONT_FALLBACK,
  SURFACE_PAGE_LOAD,
} from './routes'
import {
  FIRST_LOAD_BUDGET_KB,
  FIRST_LOAD_ROUTES,
  forbiddenModules,
} from './first-load'
import { FIRST_LOAD_CEILING_KB, FIRST_LOAD_TARGET_KB } from './routes/types'

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

  it('gives each first-load route a budget within its limit', () => {
    const routes = SURFACE_FIRST_LOAD.map((e) => e.route)
    expect(new Set(routes).size).toBe(routes.length)
    for (const entry of SURFACE_FIRST_LOAD) {
      expect(entry.route).toMatch(/^\//)
      expect(entry.budgetKb).toBeGreaterThan(0)
      const ceiling = FIRST_LOAD_CEILING_KB[entry.access]
      expect(
        entry.budgetKb,
        `${entry.route}: a ${entry.access} route's first-load budget is its first CI measurement plus 2 KB, at most ${ceiling} KB` +
          (entry.access === 'public'
            ? ` (the target is ${FIRST_LOAD_TARGET_KB} KB; more than ${ceiling} needs the owner's word)`
            : '')
      ).toBeLessThanOrEqual(ceiling)
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
    expect(FIRST_LOAD_BUDGET_KB['/system/reading']).toBe(183)
    const reading = SURFACE_PAGE_LOAD.find((e) => e.path === '/system/reading')
    expect(reading?.budget).toMatchObject({ cls: 0.05, lcpMobileMs: 2000 })
  })
})

describe('the balance code in a first load', () => {
  const pocket = '[project]/components/pocket/PocketContent.tsx'
  it('is refused on every route but the balance page', () => {
    expect(forbiddenModules([pocket], '/system/reading')).toHaveLength(1)
    expect(forbiddenModules([pocket], '/')).toHaveLength(1)
    expect(forbiddenModules([pocket], '/pocket')).toEqual([])
  })
  it('a lazily loaded sheet is refused everywhere', () => {
    const sheet = '[project]/components/pocket/sheets/AddMoney.tsx'
    expect(forbiddenModules([sheet], '/pocket')).toHaveLength(1)
  })
})
