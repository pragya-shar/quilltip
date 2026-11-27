import { expect, test, type Locator, type Page } from '@playwright/test'

// The application shell (D20) around the gallery, the sample reading page
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
  const balance = nav(page).getByRole('link', { name: /^Pocket, \$18\.40/ })
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
  await expect(item).toHaveAttribute('href', '/login')
})

test('the balance opens the Pocket over the page and gives focus back', async ({
  page,
}) => {
  await page.goto('/shelf')
  const item = nav(page).getByRole('link', { name: /^Pocket/ })
  await press(item)
  await expect(page).toHaveURL(/\/shelf/)
  const pocket = wide()
    ? page.getByRole('complementary', { name: 'Pocket' })
    : page.getByRole('dialog', { name: 'Pocket' })
  await expect(pocket).toBeVisible()
  await expect(pocket.locator('.qt-money')).toContainText('$18.40')
  await expect(pocket.getByText('Ready to tip')).toBeVisible()
  await expect(pocket.getByText('Testnet. Practice money only.')).toBeVisible()
  await expect(pocket.getByRole('heading', { name: 'Pocket' })).toBeFocused()
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
  if (!hasTouch()) await expect(item).toBeFocused()
  await expect(item).toHaveAttribute('aria-expanded', 'false')
})

test('the Pocket page, for links and for no script', async ({ page }) => {
  await page.goto('/pocket')
  await expect(
    page.getByRole('heading', { level: 1, name: 'Pocket' })
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
