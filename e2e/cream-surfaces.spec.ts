import { test, expect, type Locator } from '@playwright/test'

test.use({ trace: 'off' })

async function expectReadableText(text: Locator, surface: Locator) {
  const color = await text.evaluate((node) => getComputedStyle(node).color)
  const background = await surface.evaluate(
    (node) => getComputedStyle(node).backgroundColor
  )
  const luminance = (rgb: string) => {
    const channels = rgb
      .match(/[\d.]+/g)!
      .slice(0, 3)
      .map(Number)
    const linear = channels.map((value) => {
      const channel = value / 255
      return channel <= 0.04045
        ? channel / 12.92
        : ((channel + 0.055) / 1.055) ** 2.4
    })
    return linear[0]! * 0.2126 + linear[1]! * 0.7152 + linear[2]! * 0.0722
  }
  const a = luminance(color)
  const b = luminance(background)
  expect(
    (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)
  ).toBeGreaterThanOrEqual(4.5)
}

for (const viewport of [
  { width: 1440, height: 1000 },
  { width: 390, height: 844 },
  { width: 390, height: 480 },
]) {
  for (const theme of ['light', 'dark']) {
    test.describe(`${theme} root at ${viewport.width}×${viewport.height}`, () => {
      test.use({
        viewport,
        reducedMotion: 'reduce',
        colorScheme: theme as 'light' | 'dark',
      })
      test.beforeEach(async ({ page }) => {
        await page.addInitScript(
          (value) => localStorage.setItem('theme', value),
          theme
        )
      })

      test('landing cream dialog keeps readable ink and light native controls', async ({
        page,
      }) => {
        await page.goto('/')
        const trigger = page.getByRole('button', {
          name: 'Add a tip',
          exact: true,
        })
        await trigger.click()
        const dialog = page.getByRole('dialog', {
          name: 'Preview a little appreciation.',
        })
        const description = dialog.getByText(
          'A little support for the words that stayed with you.'
        )
        await expectReadableText(description, dialog)
        const selected = dialog.getByRole('radio', {
          name: '2 test XLM',
          exact: true,
        })
        const next = dialog.getByRole('radio', {
          name: '5 test XLM',
          exact: true,
        })
        await expect(selected).toBeChecked()
        await expect(next).not.toBeChecked()
        await expect(next).toHaveCSS('color-scheme', 'light')
        await selected.focus()
        await selected.press('ArrowRight')
        await expect(next).toBeChecked()
        await expect(next).toBeFocused()
        await expect(selected).not.toBeChecked()
        await expect(next).toHaveCSS('outline-style', 'solid')

        // A root theme can change while the portaled surface is already open.
        await page.evaluate(() => {
          document.documentElement.classList.toggle('dark')
          document.documentElement.style.colorScheme =
            document.documentElement.classList.contains('dark')
              ? 'dark'
              : 'light'
        })
        await expectReadableText(description, dialog)
        await expect(next).toHaveCSS('color-scheme', 'light')
        const submit = dialog.getByRole('button', {
          name: 'Preview 5 test XLM receipt',
        })
        await submit.scrollIntoViewIfNeeded()
        await expect(submit).toBeInViewport()
        expect(
          await dialog.evaluate((node) => node.scrollWidth <= node.clientWidth)
        ).toBe(true)
        await next.press('Escape')
        await expect(dialog).toBeHidden()
        await expect(trigger).toBeFocused()
        await trigger.click()
        await expect(next).toBeChecked()
        await submit.click()
        await expect(
          page.getByText('Demo receipt · nothing sent or saved')
        ).toBeVisible()
      })

      test('Appearance drawer keeps typography radios and explanatory ink legible', async ({
        page,
      }) => {
        test.skip(
          !process.env.PLAYWRIGHT_QA_EMAIL ||
            !process.env.PLAYWRIGHT_QA_PASSWORD,
          'Requires a disposable development QA account.'
        )
        await page.goto('/login')
        await page
          .getByLabel('Email', { exact: true })
          .fill(process.env.PLAYWRIGHT_QA_EMAIL!)
        await page
          .getByLabel('Password', { exact: true })
          .fill(process.env.PLAYWRIGHT_QA_PASSWORD!)
        await page.getByRole('button', { name: 'Log in', exact: true }).click()
        await page.waitForURL((url) => url.pathname !== '/login')
        await page.goto('/write')
        const trigger = page.getByRole('button', {
          name: 'Appearance',
          exact: true,
        })
        await trigger.click()
        const drawer = page.getByRole('dialog', { name: 'Make it yours.' })
        await expectReadableText(
          drawer.getByText('Style your article. See it in your preview.'),
          drawer
        )
        await expectReadableText(
          drawer.getByText('Expressive title, comfortable serif text'),
          drawer
        )
        const literary = drawer.getByRole('radio', {
          name: 'Literary',
          exact: true,
        })
        const modern = drawer.getByRole('radio', {
          name: 'Modern',
          exact: true,
        })
        await expect(literary).toHaveCSS('color-scheme', 'light')
        await expect(modern).toHaveCSS('color-scheme', 'light')
        await literary.check()
        await literary.focus()
        await literary.press('ArrowRight')
        await expect(modern).toBeChecked()
        await expect(literary).not.toBeChecked()
        await expect(modern).toBeFocused()
        await expect(modern).toHaveCSS('outline-style', 'solid')
        await expect(modern).toHaveCSS('outline-width', '2px')
        await page.evaluate(() => {
          document.documentElement.classList.toggle('dark')
          document.documentElement.style.colorScheme =
            document.documentElement.classList.contains('dark')
              ? 'dark'
              : 'light'
        })
        await expect(modern).toHaveCSS('color-scheme', 'light')
        await expect(modern).toBeChecked()
        await expectReadableText(
          drawer.getByText('Style your article. See it in your preview.'),
          drawer
        )
        // Exercise browser-native disabled rendering without changing application state.
        await literary.evaluate((node: HTMLInputElement) => {
          node.disabled = true
        })
        await expect(literary).toBeDisabled()
        await expect(literary).not.toBeChecked()
        await expect(literary).toHaveCSS('color-scheme', 'light')
        const back = drawer.getByRole('button', {
          name: 'Back to writing',
          exact: true,
        })
        await back.scrollIntoViewIfNeeded()
        await expect(back).toBeInViewport()
        expect(
          await drawer.evaluate((node) => node.scrollWidth <= node.clientWidth)
        ).toBe(true)
        await back.click()
        await expect(trigger).toBeFocused()
        await trigger.click()
        await expect(modern).toBeChecked()
        await modern.press('Escape')
        await expect(trigger).toBeFocused()
      })
    })
  }
}
