import { test, expect, type Page } from '@playwright/test'

// The Next.js patch (patches/next@16.4.6.ts): on `/`, `/login`, `/articles`
// and article pages the chunk scripts start after the first contentful paint,
// through public/hydrate-after-paint.js. Run against a production build
// (`bun run build && bun run start`) in Chromium, Firefox and WebKit:
//   PLAYWRIGHT_ALL_BROWSERS=1 bunx playwright test e2e/hydrate-after-paint.spec.ts
// Set PLAYWRIGHT_ARTICLE_PATH to a published article to cover that route.

const ARTICLE_PATH = process.env.PLAYWRIGHT_ARTICLE_PATH
const PATCHED_ROUTES = [
  '/',
  '/login',
  '/articles',
  ...(ARTICLE_PATH ? [ARTICLE_PATH] : []),
]
const CHUNK = /\/_next\/static\/chunks\/.+\.js(\?|$)/

test.use({ reducedMotion: 'reduce', trace: 'off', video: 'off' })

/** True once React has attached its props to the header's first link. */
async function waitForHydration(page: Page, timeout = 15_000) {
  await page.waitForFunction(
    () => {
      const link = document.querySelector(
        'main a[href], header a[href], nav a[href]'
      )
      return (
        !!link &&
        Object.keys(link).some((key) => key.startsWith('__reactProps'))
      )
    },
    undefined,
    { timeout }
  )
}

/** Holds every chunk script back, so the page stays unhydrated for a while. */
async function holdChunks(page: Page, ms: number) {
  await page.route(CHUNK, async (route) => {
    await new Promise((resolve) => setTimeout(resolve, ms))
    await route.continue()
  })
}

async function scriptShape(page: Page) {
  return page.evaluate(() => {
    const tags = [...document.querySelectorAll('script')]
    const loaders = tags.filter((s) =>
      s.src.includes('/hydrate-after-paint.js?c=')
    )
    return {
      // The copy that runs before the first paint: in <head>, without async.
      loaders: loaders.filter(
        (s) => !s.hasAttribute('async') && s.closest('head') !== null
      ).length,
      // The async bootstrap copy (`&b=1`), which does nothing when it runs.
      lateLoaders: loaders.filter((s) => s.hasAttribute('async')).length,
      inert: tags
        .filter((s) => s.hasAttribute('data-hydrate-after-paint'))
        .map((s) => s.getAttribute('data-hydrate-after-paint')!),
      started: tags
        .filter((s) => s.src.includes('/_next/static/chunks/'))
        .map((s) => new URL(s.src).pathname),
    }
  })
}

for (const path of PATCHED_ROUTES) {
  test(`${path}: chunk scripts start after the first paint and the page hydrates`, async ({
    page,
  }) => {
    const errors: string[] = []
    page.on('pageerror', (error) => errors.push(error.message))
    await page.goto(path)
    await waitForHydration(page)
    const shape = await scriptShape(page)
    expect(shape.loaders).toBe(1)
    expect(shape.lateLoaders).toBe(1)
    // Every inert tag, including those of parts that streamed in later, was
    // started as a real script.
    for (const src of shape.inert)
      expect(shape.started).toContain(new URL(src, page.url()).pathname)

    const timing = await page.evaluate(() => {
      const fcp = performance.getEntriesByName('first-contentful-paint')[0]
      const chunks = performance
        .getEntriesByType('resource')
        .filter(
          (entry) =>
            entry.name.includes('/_next/static/chunks/') &&
            entry.name.endsWith('.js')
        )
      return {
        fcp: fcp?.startTime ?? null,
        firstChunk: Math.min(...chunks.map((entry) => entry.startTime)),
      }
    })
    if (timing.fcp !== null)
      expect(timing.firstChunk).toBeGreaterThanOrEqual(timing.fcp)
    expect(errors).toEqual([])
  })
}

test('a page outside the four routes loads its scripts as Next.js does', async ({
  page,
}) => {
  await page.goto('/support')
  await waitForHydration(page)
  const shape = await scriptShape(page)
  expect(shape.loaders).toBe(0)
  expect(shape.inert).toEqual([])
  expect(shape.started.length).toBeGreaterThan(0)
})

test('the mobile menu opens from a press made before hydration', async ({
  page,
}) => {
  await page.setViewportSize({ width: 375, height: 812 })
  await holdChunks(page, 2500)
  await page.goto('/articles')
  await page.getByRole('button', { name: 'Open navigation menu' }).click()
  await expect(page.getByRole('dialog', { name: 'Find your way' })).toBeVisible(
    {
      timeout: 15_000,
    }
  )
})

test('a press right after the first paint is held, even when the loader is slow', async ({
  page,
}) => {
  // The loader is in <head> without async, so nothing is parsed or painted
  // before it has started holding presses. With the earlier async loader, a
  // press between the first paint and the loader's arrival was lost: the
  // button was on screen and did nothing.
  await page.setViewportSize({ width: 375, height: 812 })
  await holdChunks(page, 2500)
  await page.route(/\/hydrate-after-paint\.js\?/, async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 1500))
    await route.continue()
  })
  await page.goto('/articles', { waitUntil: 'commit' })
  // Pressed as soon as the button is on the page.
  await page.getByRole('button', { name: 'Open navigation menu' }).click()
  await expect(page.getByRole('dialog', { name: 'Find your way' })).toBeVisible(
    { timeout: 15_000 }
  )
})

test('the landing tip preview opens from a press made before hydration', async ({
  page,
}) => {
  // React hydrates this button after the body, so the hold must wait for the
  // button itself.
  await page.setViewportSize({ width: 375, height: 812 })
  await holdChunks(page, 2500)
  await page.goto('/')
  await page.getByRole('button', { name: 'Add a tip', exact: true }).click()
  await expect(
    page.getByRole('dialog', { name: 'Preview a little appreciation.' })
  ).toBeVisible({ timeout: 20_000 })
})

test('a sign-in sent before hydration is sent again, not lost', async ({
  page,
}) => {
  await holdChunks(page, 2500)
  await page.goto('/login')
  await page.getByLabel('Email', { exact: true }).fill('nobody@perf.local')
  await page.getByLabel('Password', { exact: true }).fill('not-the-password-1')
  await page.getByRole('button', { name: 'Log in', exact: true }).click()
  // React handles the held submit: the backend refuses the account.
  await expect(
    page.getByText('Invalid email or password', { exact: false })
  ).toContainText('Invalid email or password', {
    timeout: 20_000,
  })
  // The browser never sent the form itself (a GET would put the fields in
  // the URL).
  expect(page.url()).not.toContain('password')
  expect(new URL(page.url()).pathname).toBe('/login')
})

test('client navigation and route prefetch work after hydration', async ({
  page,
}) => {
  await page.goto('/')
  await waitForHydration(page)
  const prefetch = page.waitForRequest(
    (request) => request.url().includes('_rsc='),
    {
      timeout: 15_000,
    }
  )
  await page.evaluate(() => {
    ;(window as unknown as { samePage: boolean }).samePage = true
  })
  await prefetch
  await page
    .getByRole('navigation', { name: 'Main navigation', exact: true })
    .getByRole('link', { name: 'Articles', exact: true })
    .click()
  await expect(page).toHaveURL(/\/articles$/)
  await expect(
    page.getByRole('heading', { name: 'Story time.', exact: true })
  ).toBeVisible()
  // No full page load: the window kept its state.
  expect(
    await page.evaluate(
      () => (window as unknown as { samePage?: boolean }).samePage
    )
  ).toBe(true)
})

test('a missing article shows the not-found page and hydrates', async ({
  page,
}) => {
  const response = await page.goto('/nobody-here-perf/no-such-article')
  expect(response?.status()).toBe(404)
  await waitForHydration(page)
  expect((await scriptShape(page)).loaders).toBe(1)
})

test.describe('the loader starts the scripts without a paint entry', () => {
  test('when the browser has no PerformanceObserver', async ({ page }) => {
    await page.addInitScript(() => {
      // @ts-expect-error simulate a browser without paint timing
      delete window.PerformanceObserver
    })
    const started = Date.now()
    await page.goto('/login')
    await waitForHydration(page)
    expect(Date.now() - started).toBeLessThan(10_000)
  })

  test('in a tab that is hidden while it loads', async ({ page }) => {
    await page.addInitScript(() => {
      Object.defineProperty(document, 'visibilityState', {
        get: () => 'hidden',
      })
    })
    await page.goto('/login')
    await waitForHydration(page)
  })

  test('after the back/forward cache restores the page', async ({ page }) => {
    await page.goto('/login')
    await waitForHydration(page)
    await page.goto('/articles')
    await waitForHydration(page)
    await page.goBack()
    await expect(page).toHaveURL(/\/login$/)
    await waitForHydration(page)
    await page.getByLabel('Email', { exact: true }).fill('nobody@perf.local')
    await page
      .getByLabel('Password', { exact: true })
      .fill('not-the-password-1')
    await page.getByRole('button', { name: 'Log in', exact: true }).click()
    await expect(
      page.getByText('Invalid email or password', { exact: false })
    ).toBeVisible({
      timeout: 20_000,
    })
  })
})
