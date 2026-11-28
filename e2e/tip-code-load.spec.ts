import { test, expect, type Page } from '@playwright/test'

import { installVarialEmulator } from './helpers/varialEmulator'

/**
 * A failed load of the tip form's code (#669): offline, or a deploy that
 * replaced the chunk. The article stays, the dialog says the form could not
 * load, and "Try again" loads it. Runs on the v2 tip fixture built with code
 * splitting (e2e/fixtures/tips-v2/server-split.mjs).
 */
const UNUSED = 'GBZXN7PIRZGNMHGA7MUUUF4GWPY5AYPV6LY4UV2GL6VJGIQRXFDNMADI'

/**
 * The chunks the entry imports statically: the page cannot render without
 * them, so a page-load failure blocks only the chunks outside this set.
 */
async function staticChunks(page: Page): Promise<Set<string>> {
  const seen = new Set<string>()
  const queue = ['/page.js']
  while (queue.length) {
    const file = queue.pop()!
    const text = await (await page.request.get(file)).text()
    for (const match of text.matchAll(
      /(?:^|[;\n])\s*import\s*(?:[^'"()]*?from\s*)?["']\.\/(chunk-[a-z0-9]+\.js)["']/g
    )) {
      const chunk = `/${match[1]}`
      if (!seen.has(chunk)) {
        seen.add(chunk)
        queue.push(chunk)
      }
    }
  }
  return seen
}

async function openOffline(page: Page) {
  await page.addInitScript(installVarialEmulator, {
    mode: 'connected' as const,
    address: UNUSED,
  })
  await page.goto('/')
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Tip article' })).toBeVisible()
  // From here no new chunk loads: the reader is offline.
  const failed: string[] = []
  await page.route('**/chunk-*.js', (route) => {
    failed.push(new URL(route.request().url()).pathname)
    return route.abort('internetdisconnected')
  })
  return failed
}

test('a tip form that fails to load leaves the article, and Try again loads it', async ({
  page,
  browserName,
}) => {
  // WebKit does not re-fetch the chunks a failed chunk imports in this
  // fixture (native module cache); a production build passes there.
  test.skip(browserName === 'webkit', 'Fixture module cache, see above.')
  const failed = await openOffline(page)
  await page.getByRole('button', { name: 'Tip article' }).click()
  const dialog = page.getByRole('dialog', { name: 'Tip this article' })
  const alert = dialog.getByRole('alert')
  await expect(alert).toContainText('The tip form couldn’t load')
  await expect(alert).toContainText('Nothing was sent.')
  expect(failed.length).toBeGreaterThan(0)
  // The article is still on the page (the open dialog hides it from the
  // accessibility tree, so by text and tag).
  await expect(page.getByText(/^Opening line\./)).toBeVisible()
  await expect(page.locator('h1')).toBeVisible()

  await page.unroute('**/chunk-*.js')
  await dialog.getByRole('button', { name: 'Try again' }).click()
  await expect(dialog.getByLabel('Other amount')).toBeVisible()
  await expect(dialog.getByRole('alert')).toHaveCount(0)
  // Focus stays in the dialog after the retry.
  expect(
    await page.evaluate(
      () => !!document.activeElement?.closest('[role="dialog"]')
    )
  ).toBe(true)
})

test('tip buttons that fail to load at page load leave the article, and Try again brings them back', async ({
  page,
  browserName,
}) => {
  // WebKit does not re-fetch the chunks a failed chunk imports in this
  // fixture (native module cache); a production build passes there.
  test.skip(browserName === 'webkit', 'Fixture module cache, see above.')
  await page.addInitScript(installVarialEmulator, {
    mode: 'connected' as const,
    address: UNUSED,
  })
  // Offline before the tip code loads: the page's own chunks load, the
  // tip buttons' chunks never do.
  const keep = await staticChunks(page)
  const failed: string[] = []
  await page.route('**/chunk-*.js', (route) => {
    const path = new URL(route.request().url()).pathname
    if (keep.has(path)) return route.continue()
    failed.push(path)
    return route.abort('internetdisconnected')
  })
  await page.goto('/')
  await expect(page.locator('h1')).toBeVisible()
  await expect(page.getByText(/^Opening line\./)).toBeVisible()
  const notices = page
    .getByRole('alert')
    .filter({ hasText: 'Tips couldn’t load.' })
  await expect(notices.first()).toBeVisible()
  expect(failed.length).toBeGreaterThan(0)
  await expect(page.getByRole('button', { name: 'Tip article' })).toHaveCount(0)

  await page.unroute('**/chunk-*.js')
  // Each notice retries its own control; retry them all.
  for (let i = 0; i < 5 && (await notices.count()) > 0; i += 1) {
    await notices.first().getByRole('button', { name: 'Try again' }).click()
  }
  await expect(notices).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Tip article' })).toBeVisible()
  await expect(page.getByText(/^Opening line\./)).toBeVisible()
})

// Focus after Try again, by keyboard. In this fixture WebKit does not re-fetch
// the chunks a failed chunk imports (native module cache), so a retry that
// succeeds only loads in Chromium; the real-build check covers WebKit.
const focused = (page: Page) =>
  page.evaluate(() => {
    const active = document.activeElement as HTMLElement | null
    if (!active || active === document.body) return 'BODY'
    return (active.getAttribute('aria-label') ?? active.textContent ?? '')
      .trim()
      .slice(0, 40)
  })

async function blockedAtLoad(page: Page) {
  await page.addInitScript(installVarialEmulator, {
    mode: 'connected' as const,
    address: UNUSED,
  })
  const keep = await staticChunks(page)
  const aborted: string[] = []
  await page.route('**/chunk-*.js', (route) => {
    const path = new URL(route.request().url()).pathname
    if (keep.has(path)) return route.continue()
    aborted.push(path)
    return route.abort('internetdisconnected')
  })
  await page.goto('/')
  await expect(page.locator('h1')).toBeVisible()
  const notices = page
    .getByRole('alert')
    .filter({ hasText: 'Tips couldn’t load.' })
  await expect(notices.first()).toBeVisible()
  return { notices, aborted }
}

test('keyboard: a retry that succeeds moves focus to the restored control', async ({
  page,
  browserName,
}) => {
  test.skip(browserName === 'webkit', 'Fixture-only: see the note above.')
  const { notices } = await blockedAtLoad(page)
  const before = await notices.count()
  await page.unroute('**/chunk-*.js')
  await notices.first().getByRole('button', { name: 'Try again' }).focus()
  await page.keyboard.press('Enter')
  await expect(notices).toHaveCount(before - 1)
  await expect.poll(() => focused(page)).not.toBe('BODY')
  expect(await focused(page)).not.toBe('Try again')
})

test('keyboard: a retry that fails again moves focus to the new Try again', async ({
  page,
}) => {
  const { notices, aborted } = await blockedAtLoad(page)
  const requestsBefore = aborted.length
  await notices.first().getByRole('button', { name: 'Try again' }).focus()
  await page.keyboard.press('Enter')
  // The retry ran: the code was requested again, and failed again.
  await expect.poll(() => aborted.length).toBeGreaterThan(requestsBefore)
  await expect.poll(() => focused(page)).toBe('Try again')
})

test('keyboard: focus stays where the reader moved it while the retry loads', async ({
  page,
  browserName,
}) => {
  test.skip(browserName === 'webkit', 'Fixture-only: see the note above.')
  const { notices } = await blockedAtLoad(page)
  await page.unroute('**/chunk-*.js')
  let release!: () => void
  const held = new Promise<void>((resolve) => (release = resolve))
  await page.route('**/chunk-*.js', async (route) => {
    await held
    await route.continue()
  })
  await notices.first().getByRole('button', { name: 'Try again' }).focus()
  await page.keyboard.press('Enter')
  // The reader moves on before the code arrives.
  await page.locator('h1').evaluate((heading) => {
    heading.setAttribute('tabindex', '-1')
    ;(heading as HTMLElement).focus()
  })
  release()
  await page.waitForTimeout(1500)
  expect(await page.evaluate(() => document.activeElement?.tagName)).toBe('H1')
})

test('keyboard: a retry in the tip dialog keeps focus in the dialog', async ({
  page,
  browserName,
}) => {
  test.skip(browserName === 'webkit', 'Fixture-only: see the note above.')
  await page.addInitScript(installVarialEmulator, {
    mode: 'connected' as const,
    address: UNUSED,
  })
  await page.goto('/')
  const tip = page.getByRole('button', { name: 'Tip article' })
  await expect(tip).toBeVisible()
  await page.route('**/chunk-*.js', (route) =>
    route.abort('internetdisconnected')
  )
  await tip.click()
  const dialog = page.getByRole('dialog', { name: 'Tip this article' })
  await expect(dialog.getByRole('alert')).toBeVisible()
  await page.unroute('**/chunk-*.js')
  await dialog.getByRole('button', { name: 'Try again' }).focus()
  await page.keyboard.press('Enter')
  await expect(dialog.getByLabel('Other amount')).toBeVisible()
  // The dialog's focus trap takes focus to the dialog itself when the pressed
  // Try again unmounts, so the boundary leaves it there.
  expect(
    await page.evaluate(() => document.activeElement?.getAttribute('role'))
  ).toBe('dialog')
})
