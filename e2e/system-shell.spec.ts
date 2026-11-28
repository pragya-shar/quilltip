import { expect, test, type Locator, type Page } from '@playwright/test'
import { expectFocusWraps, expectOpensOnTitle } from './helpers/modalFocus'
import { signInPathFromRoutes } from '../lib/routing/signInPath'

// The application shell around the gallery, the sample reading page
// and the shell's own pages (e2e/fixtures/system): the bar or the rail with
// Today, Shelf, Write and the balance; the Pocket over the page; pushed
// screens; the bar stepping aside for the keyboard.

test.skip(
  !process.env.SYSTEM_FIXTURES,
  'Needs the design system fixture server (bun run test:e2e:fixtures --suite system)'
)

const wide = () => (test.info().project.use.viewport?.width ?? 0) >= 1024
const hasTouch = () => Boolean(test.info().project.use.hasTouch)

async function press(target: Locator) {
  if (hasTouch()) await target.tap()
  else await target.click()
}

const nav = (page: Page) => page.getByRole('navigation', { name: 'Main' })

test('one navigation: three places and the balance, as real links', async ({
  page,
}) => {
  await page.goto('/shelf')
  await expect(nav(page)).toHaveCount(1)
  const links = nav(page).getByRole('link')
  await expect(links).toHaveCount(wide() ? 5 : 4)
  await expect(nav(page).getByRole('link', { name: 'Today' })).toHaveAttribute(
    'href',
    '/'
  )
  await expect(nav(page).getByRole('link', { name: 'Write' })).toHaveAttribute(
    'href',
    '/write'
  )
  const shelf = nav(page).getByRole('link', { name: 'Shelf' })
  await expect(shelf).toHaveAttribute('href', '/shelf')
  await expect(shelf).toHaveAttribute('aria-current', 'page')
  const balance = nav(page).getByRole('link', {
    name: 'Balance, 18 dollars 40. Open balance',
  })
  await expect(balance).toHaveAttribute('href', '/pocket')
  await expect(balance).toContainText('$18.40')
  if (wide()) {
    await expect(page.locator('.qt-rail')).toBeVisible()
    await expect(page.locator('.qt-navbar')).toBeHidden()
  } else {
    await expect(page.locator('.qt-navbar')).toBeVisible()
    await expect(page.locator('.qt-rail')).toBeHidden()
    for (const link of await links.all()) {
      const box = await link.boundingBox()
      expect(box!.height).toBeGreaterThanOrEqual(44)
      expect(box!.width).toBeGreaterThanOrEqual(44)
    }
  }
})

test('signed out, the balance item reads Sign in', async ({ page }) => {
  await page.goto('/shelf?balance=signed-out')
  const item = nav(page).getByRole('link', { name: 'Sign in' })
  await expect(item).toBeVisible()
  await expect(item).toHaveAttribute('href', signInPathFromRoutes())
})

test('the balance opens the Pocket over the page and gives focus back', async ({
  page,
}) => {
  await page.goto('/shelf')
  const item = nav(page).getByRole('link', { name: /^Balance/ })
  await press(item)
  await expect(page).toHaveURL(/\/shelf/)
  const pocket = wide()
    ? page.getByRole('complementary', { name: 'Balance' })
    : page.getByRole('dialog', { name: 'Balance' })
  await expect(pocket).toBeVisible()
  await expect(pocket.locator('.qt-money')).toContainText('$18.40')
  await expect(pocket.getByText('Ready to tip')).toBeVisible()
  await expect(pocket.getByText('Testnet. Practice money only.')).toBeVisible()
  await expect(pocket.getByRole('heading', { name: 'Balance' })).toBeFocused()
  expect(
    await page.evaluate(
      () => getComputedStyle(document.activeElement as Element).outlineStyle
    )
  ).toBe('none')
  // The page underneath is still there.
  await expect(
    page.getByRole('heading', { level: 1, name: 'Shelf' })
  ).toBeAttached()
  await page.keyboard.press('Escape')
  await expect(pocket).toBeHidden()
  // Back on the item, opened by a tap or a click as well (Safari focuses no
  // pressed link, so the sheet remembers what was pressed).
  await expect(item).toBeFocused()
  await expect(item).toHaveAttribute('aria-expanded', 'false')
})

test('a change of path closes the sheets over the old page', async ({
  page,
}) => {
  test.skip(wide(), 'On a desktop the balance is a panel, not a sheet')
  await page.goto('/shelf')
  await press(nav(page).getByRole('link', { name: /^Balance/ }))
  const pocket = page.getByRole('dialog', { name: 'Balance' })
  await expect(pocket).toBeVisible()
  // A client navigation, as a link inside the sheet would make.
  await page.evaluate(() => {
    history.pushState({}, '', '/')
    dispatchEvent(new PopStateEvent('popstate'))
  })
  await expect(pocket).toBeHidden()
})

test('while no amount is known, the item reads Balance, not a figure', async ({
  page,
}) => {
  await page.goto('/shelf?balance=unavailable')
  const item = nav(page).getByRole('link', { name: 'Balance' })
  await expect(item).toHaveText('Balance')
  await expect(item).not.toContainText('$')
})

test('signed out, a registered sign-in sheet opens over the page', async ({
  page,
}) => {
  await page.goto('/shelf?balance=signed-out&signin=sheet')
  await press(nav(page).getByRole('link', { name: 'Sign in' }))
  const sheet = page.getByRole('dialog', { name: 'Sign in to Quilltip' })
  await expect(sheet).toBeVisible()
  await expect(page).toHaveURL(/\/shelf/)
  await expect(
    sheet.getByRole('heading', { name: 'Sign in to Quilltip' })
  ).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(sheet).toBeHidden()
})

test('a declared sheet opens before its code has loaded, then fills in', async ({
  page,
}) => {
  await page.goto('/sheets')
  await press(page.getByRole('button', { name: 'Open the lazy sheet' }))
  const sheet = page.getByRole('dialog', { name: 'Add money to tip $3' })
  await expect(sheet).toBeVisible()
  await expect(
    sheet.getByRole('heading', { name: 'Add money to tip $3' })
  ).toBeFocused()
  await expect(sheet.getByText('Loaded on demand for $3.')).toBeVisible()
  await expect(sheet.locator('[aria-busy="true"]')).toHaveCount(0)
  await press(sheet.getByRole('button', { name: 'Done' }))
  await expect(sheet).toBeHidden()
})

test('a sheet whose code fails to load says so and tries again', async ({
  page,
}) => {
  await page.goto('/sheets')
  await press(
    page.getByRole('button', { name: 'Open the sheet that fails once' })
  )
  const sheet = page.getByRole('dialog', { name: 'Withdraw' })
  await expect(sheet.getByText('This did not load')).toBeVisible()
  await press(sheet.getByRole('button', { name: 'Try again' }))
  await expect(sheet.getByText('Loaded on demand.')).toBeVisible()
})

test('a converted balance reads about, and every state keeps the slot width', async ({
  page,
}) => {
  await page.goto('/shelf?balance=converted')
  const item = nav(page).getByRole('link', {
    name: 'Balance, about 18 dollars 40. Open balance',
  })
  await expect(item).toContainText('≈')
  await expect(item).toContainText('$18')
  const widths: number[] = []
  for (const state of [
    'converted',
    'ready',
    'loading',
    'unavailable',
    'signed-out',
  ]) {
    await page.goto(`/shelf?balance=${state}`)
    const box = await nav(page)
      .locator('.qt-balance-slot:visible')
      .boundingBox()
    widths.push(Math.round(box!.width))
  }
  expect(new Set(widths).size).toBe(1)
})

for (const width of [360, 390]) {
  test(`a toast never covers the docked tip bar (${width} px)`, async ({
    page,
  }) => {
    test.skip(wide(), 'Phone widths')
    await page.setViewportSize({ width, height: 800 })
    await page.goto('/reading')
    const dock = page.locator('.qt-dock')
    await press(dock.getByRole('button', { name: /^Tip Tomás/ }))
    const toast = page
      .locator('.qt-toast')
      .filter({ hasText: 'You tipped Tomás' })
    await expect(toast).toBeVisible()
    const a = (await toast.boundingBox())!
    const b = (await dock.boundingBox())!
    const overlap =
      a.x < b.x + b.width &&
      b.x < a.x + a.width &&
      a.y < b.y + b.height &&
      b.y < a.y + a.height
    expect(
      overlap,
      `toast ${JSON.stringify(a)} dock ${JSON.stringify(b)}`
    ).toBe(false)
  })
}

test('when the balance code fails to load, the overlay says so and the page stays', async ({
  page,
}) => {
  await page.goto('/shelf?pocket=fail')
  await press(nav(page).getByRole('link', { name: /^Balance/ }))
  const pocket = wide()
    ? page.getByRole('complementary', { name: 'Balance' })
    : page.getByRole('dialog', { name: 'Balance' })
  await expect(pocket.getByText('This did not load')).toBeVisible()
  await expect(
    page.getByRole('heading', { level: 1, name: 'Shelf' })
  ).toBeAttached()
  await page.evaluate(() => {
    ;(window as unknown as { __pocketLoads: boolean }).__pocketLoads = true
  })
  await press(pocket.getByRole('button', { name: 'Try again' }))
  await expect(pocket.getByText('Ready to tip')).toBeVisible()
})

test('the Pocket page, for links and for no script', async ({ page }) => {
  await page.goto('/pocket')
  await expect(
    page.getByRole('heading', { level: 1, name: 'Balance' })
  ).toBeVisible()
  await expect(page.getByText('Ready to tip')).toBeVisible()
  if (!wide()) await expect(page.locator('.qt-navbar')).toBeHidden()
})

test('a pushed screen hides the phone bar, keeps a way back, and does not animate on arrival', async ({
  page,
}) => {
  await page.goto('/reading')
  await expect(
    page.getByRole('heading', {
      level: 1,
      name: 'What my grandmother’s ledger taught me about money',
    })
  ).toBeVisible()
  await expect(page.locator('.qt-navbar')).toBeHidden()
  await expect(page.locator('.qt-pushed')).not.toHaveAttribute(
    'data-arrived',
    /.*/
  )
  await expect(
    page.getByRole('link', { name: 'Back to reading' })
  ).toHaveAttribute('href', '/')
  await expect(
    page.getByRole('link', { name: 'Read more articles' })
  ).toHaveAttribute('href', '/articles')
})

test('the phone bar sits above the content, never over the last line', async ({
  page,
}) => {
  test.skip(wide(), 'Phone and tablet')
  await page.goto('/')
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight))
  const bar = await page.locator('.qt-navbar .qt-navbar__list').boundingBox()
  const last = await page.locator('.qt-gallery__section').last().boundingBox()
  expect(last!.y + last!.height).toBeLessThanOrEqual(bar!.y)
})

test('the phone bar steps aside while the keyboard is up', async ({ page }) => {
  test.skip(!hasTouch() || wide(), 'Touch phones and tablets')
  await page.goto('/')
  const bar = page.locator('.qt-navbar')
  await expect(bar).toBeVisible()
  await page.getByRole('textbox', { name: 'Name on your tips' }).tap()
  await expect(bar).toBeHidden()
  // A checkbox raises no keyboard: the bar stays.
  await page.getByText('Refuse the next tip').tap()
  await expect(bar).toBeVisible()
})

test('the skip link moves focus to the content', async ({
  page,
  browserName,
}) => {
  await page.goto('/')
  // WebKit, like Safari, includes links in the Tab order only with Option.
  await page.keyboard.press(browserName === 'webkit' ? 'Alt+Tab' : 'Tab')
  await page.keyboard.press('Enter')
  await expect(page.locator('#content')).toBeFocused()
})

test('every sheet: title first, focus wraps, Escape and Close return it', async ({
  page,
}) => {
  // The balance, as a sheet on a phone.
  if (!wide()) {
    await page.goto('/shelf')
    const item = nav(page).getByRole('link', { name: /^Balance/ })
    await item.focus()
    await page.keyboard.press('Enter')
    const pocket = page.getByRole('dialog', { name: 'Balance' })
    await expectOpensOnTitle(pocket)
    await expectFocusWraps(page, pocket)
    await page.keyboard.press('Escape')
    await expect(pocket).toBeHidden()
    await expect(item).toBeFocused()
  }

  // A sheet that loads on demand: still on its title once its body arrives.
  await page.goto('/sheets')
  const opener = page.getByRole('button', { name: 'Open the lazy sheet' })
  await opener.focus()
  await page.keyboard.press('Enter')
  const lazy = page.getByRole('dialog', { name: 'Add money to tip $3' })
  await expect(lazy.getByText('Loaded on demand for $3.')).toBeVisible()
  await expectOpensOnTitle(lazy)
  await expectFocusWraps(page, lazy)
  await lazy.getByRole('button', { name: 'Close' }).focus()
  await page.keyboard.press('Enter')
  await expect(lazy).toBeHidden()
  await expect(opener).toBeFocused()
})

test('with its opener gone, a closed sheet gives focus to the page, never the body', async ({
  page,
}) => {
  await page.goto('/sheets')
  await page.getByRole('button', { name: 'Open, and the opener goes' }).focus()
  await page.keyboard.press('Enter')
  const sheet = page.getByRole('dialog', { name: 'The opener is gone' })
  await expectOpensOnTitle(sheet)
  await page.keyboard.press('Escape')
  await expect(sheet).toBeHidden()
  await expect
    .poll(() => page.evaluate(() => document.activeElement?.id ?? ''))
    .toBe('content')
})

test('a sheet that goes while the page moves focus leaves focus there', async ({
  page,
}) => {
  await page.goto('/sheets')
  const opener = page.getByRole('button', {
    name: 'Open, then the page moves on',
  })
  await opener.focus()
  await page.keyboard.press('Enter')
  const sheet = page.getByRole('dialog', { name: 'The page moves on' })
  await expectOpensOnTitle(sheet)
  await sheet.getByRole('button', { name: 'Go on' }).focus()
  await page.keyboard.press('Enter')
  await expect(sheet).toHaveCount(0)
  await page.waitForTimeout(400) // past the sheet's exit
  await expect(
    page.getByRole('button', { name: 'Where the page went' })
  ).toBeFocused()
})

test('while auth loads with a held token, the Balance item opens the balance', async ({
  page,
}) => {
  await page.goto('/shelf?balance=auth-loading')
  await page.evaluate(() =>
    localStorage.setItem('__convexAuthJWT_test', 'held')
  )
  await page.reload()
  // The fixture runs no pre-paint script, so the word on the item is not
  // the point here: where it goes, and what a press does, are.
  const item = nav(page).locator('[data-balance]:visible')
  await expect(item).toHaveAttribute('href', '/pocket')
  await press(item)
  // Over the page, not off to the sign-in page.
  await expect(page).toHaveURL(/\/shelf\?balance=auth-loading$/)
  const pocket = wide()
    ? page.getByRole('complementary', { name: 'Balance' })
    : page.getByRole('dialog', { name: 'Balance' })
  await expect(pocket).toBeVisible()
})

test('while auth loads with no token, the item is still the way to sign in', async ({
  page,
}) => {
  await page.goto('/shelf?balance=auth-loading')
  const item = nav(page).locator('[data-balance]:visible')
  await expect(item).toHaveAttribute('href', /\/(login|signin)/)
})
