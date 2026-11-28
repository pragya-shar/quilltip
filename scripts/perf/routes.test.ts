import { existsSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  FIRST_LOAD_ENTRIES,
  FONT_FALLBACK_ROUTES,
  NO_SCRIPT_ROUTES,
  PAGE_LOAD_ROUTES,
  PERF_ROUTE_PACKAGES,
  legacyPageDeleted,
  UNMEASURED,
  SURFACE_FIRST_LOAD,
  SURFACE_FONT_FALLBACK,
  SURFACE_PAGE_LOAD,
  mergePackageRoutes,
} from './routes'
import {
  FIRST_LOAD_BUDGET_KB,
  FIRST_LOAD_ROUTES,
  forbiddenModules,
} from './first-load'
import { FIRST_LOAD_CEILING_KB, FIRST_LOAD_TARGET_KB } from './routes/types'
import {
  LEGACY_FIRST_LOAD,
  LEGACY_FONT_FALLBACK,
  LEGACY_PAGE_LOAD,
} from './routes/legacy'

const root = path.resolve(__dirname, '../..')

/** Next.js route names of the pages under a directory: groups dropped,
 * and the signed-in group left out (its pages need an account). */
function pageRoutes(dir: string, prefix = ''): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name)
    if (name === '(signed-in)') return []
    if (statSync(full).isDirectory()) {
      const segment = /^\(.*\)$/.test(name) ? '' : `/${name}`
      return pageRoutes(full, `${prefix}${segment}`)
    }
    return name === 'page.tsx' ? [prefix || '/'] : []
  })
}

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
          ` (more than ${ceiling} needs the owner's word` +
          (entry.access === 'public'
            ? `; the target is ${FIRST_LOAD_TARGET_KB} KB)`
            : ')')
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
        if (typeof kb === 'number') expect(kb).toBeGreaterThan(0)
  })

  it('drops a foundation placeholder when a package names its route', () => {
    const merged = mergePackageRoutes({
      foundation: {
        firstLoad: [
          { route: '/system/reading', budgetKb: 186, access: 'public' },
          { route: '/shelf', budgetKb: 183, access: 'public' },
        ],
        fontFallback: [{ name: 'shelf', path: '/shelf', gateMovement: true }],
      },
      shelf: {
        firstLoad: [{ route: '/shelf', budgetKb: 179, access: 'public' }],
        fontFallback: [
          { name: 'shelf page', path: '/shelf', gateMovement: true },
        ],
      },
    })
    expect(merged.firstLoad).toEqual([
      { route: '/system/reading', budgetKb: 186, access: 'public' },
      { route: '/shelf', budgetKb: 179, access: 'public' },
    ])
    expect(merged.fontFallback.map((e) => e.name)).toEqual(['shelf page'])
  })

  it('keeps the shell reading page measured, at the public limits', () => {
    expect(FIRST_LOAD_BUDGET_KB['/system/reading']).toBe(189)
    const reading = SURFACE_PAGE_LOAD.find((e) => e.path === '/system/reading')
    expect(reading?.budget).toMatchObject({ cls: 0.05, lcpMobileMs: 2000 })
  })
})

describe('payments code in a first load', () => {
  it('is the store alone on a shell route', () => {
    const store = '[project]/lib/payments/store.ts'
    const engine = '[project]/lib/payments/tip-machine.ts'
    const shell = '[project]/components/payments/PaymentsShell.tsx'
    expect(forbiddenModules([store], '/system/reading')).toEqual([])
    expect(
      forbiddenModules(
        [`${store} [app-client] (ecmascript)`],
        '/system/reading'
      )
    ).toEqual([])
    expect(forbiddenModules([engine], '/system/reading')).toHaveLength(1)
    expect(forbiddenModules([shell], '/system/reading')).toHaveLength(1)
    // The legacy layout mounts the payments shell itself.
    expect(forbiddenModules([shell], '/[username]/[slug]')).toEqual([])
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

describe('the legacy lists, replaced without editing them', () => {
  it('measures each route and path once', () => {
    const routes = FIRST_LOAD_ENTRIES.map((e) => e.route)
    expect(new Set(routes).size).toBe(routes.length)
    for (const list of [PAGE_LOAD_ROUTES, FONT_FALLBACK_ROUTES]) {
      const paths = list.map((e) => e.path)
      expect(new Set(paths).size).toBe(paths.length)
      const names = list.map((e) => e.name)
      expect(new Set(names).size).toBe(names.length)
    }
  })

  it('names a page that exists or is listed as deleted for each legacy entry', () => {
    for (const entry of [
      ...LEGACY_FIRST_LOAD,
      ...LEGACY_PAGE_LOAD,
      ...LEGACY_FONT_FALLBACK,
    ])
      expect(
        existsSync(path.join(root, entry.page)) ||
          legacyPageDeleted(entry.page),
        entry.page
      ).toBe(true)
  })

  it('drops a legacy entry whose page is listed as deleted', () => {
    const page = 'app/(legacy)/articles/page.tsx'
    expect(legacyPageDeleted(page, ['app/(legacy)/articles'])).toBe(true)
    expect(legacyPageDeleted(page, [page])).toBe(true)
    expect(legacyPageDeleted(page, ['app/(legacy)/article'])).toBe(false)
  })

  it('keeps the legacy entries no package replaced', () => {
    for (const entry of LEGACY_FIRST_LOAD)
      if (
        !legacyPageDeleted(entry.page) &&
        !SURFACE_FIRST_LOAD.some((own) => own.route === entry.route)
      )
        expect(FIRST_LOAD_ROUTES).toContain(entry.route)
  })
})

describe('every public route of the shell', () => {
  // Every page open signed out: app/(app)/(public), and pages directly
  // under app/(app) (Write), but not app/(app)/(signed-in).
  const publicRoutes = pageRoutes(path.join(root, 'app/(app)'))
  const unmeasured = new Map(UNMEASURED.map((e) => [e.route, e.reason]))

  it('has a first-load budget and a no-script check, or says why not', () => {
    const missing = publicRoutes.filter(
      (route) =>
        !unmeasured.has(route) &&
        !(FIRST_LOAD_ROUTES.includes(route) && NO_SCRIPT_ROUTES.has(route))
    )
    expect(missing).toEqual([])
    for (const [route, reason] of unmeasured) {
      expect(publicRoutes, `unmeasured ${route}`).toContain(route)
      expect(reason.length, route).toBeGreaterThan(20)
    }
  })

  it('keeps the server-HTML rule for the largest paint on public routes', () => {
    // Only a signed-in page drawn from the browser's session may report it
    // instead of gating it: its path is a signed-in first-load route of the
    // same package, and never a public one.
    for (const [name, pkg] of Object.entries(PERF_ROUTE_PACKAGES)) {
      const access = new Map(
        (pkg.firstLoad ?? []).map((entry) => [entry.route, entry.access])
      )
      for (const entry of pkg.pageLoad ?? [])
        if (entry.budget.lcpInServerHtml === false)
          expect(access.get(entry.path), `${name} ${entry.path}`).toBe(
            'signed-in'
          )
    }
    // Every page under the check, the legacy ones included.
    for (const entry of PAGE_LOAD_ROUTES)
      if (entry.budget.lcpInServerHtml === false)
        expect(
          SURFACE_FIRST_LOAD.some(
            (load) => load.route === entry.path && load.access === 'signed-in'
          ),
          entry.path
        ).toBe(true)
  })

  it('budgets public routes as public', () => {
    for (const route of publicRoutes) {
      const entry = SURFACE_FIRST_LOAD.find((e) => e.route === route)
      if (entry) expect(entry.access, route).toBe('public')
    }
  })
})
