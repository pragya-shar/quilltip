import { expect, test } from '@playwright/test'

test.use({ trace: 'off' })

for (const viewport of [
  { width: 1440, height: 1000 },
  { width: 390, height: 844 },
]) {
  test.describe(`Writer introduction at ${viewport.width}px`, () => {
    test.use({ viewport, reducedMotion: 'reduce' })

    test('presents the complete sample, keyboard stages and guest handoff', async ({
      page,
    }) => {
      await page.goto('/demo/write')
      const typewriter = page.locator('.writer-intro-typewriter svg')
      await expect(typewriter).toBeVisible()
      await expect(typewriter.getByText('A beginning.')).toBeVisible()
      await expect(page.getByRole('button', { name: /hold/i })).toHaveCount(0)
      await expect(
        page.getByRole('tabpanel').getByText('Sample only')
      ).toBeVisible()
      const write = page.getByRole('tab', { name: 'Write', exact: true })
      const publish = page.getByRole('tab', { name: 'Publish', exact: true })
      await expect(write).toHaveAttribute('aria-selected', 'true')
      await write.press('ArrowRight')
      await expect(publish).toBeFocused()
      await expect(publish).toHaveAttribute('aria-selected', 'true')
      await expect(page.locator('.writer-intro-paper')).toHaveCSS(
        'background-color',
        'rgb(102, 0, 51)'
      )
      const finish = page.locator('.writer-intro-finish')
      await expect(
        finish.getByText('Sign in to save drafts and begin your own story.')
      ).toBeVisible()
      await expect(finish.getByRole('link')).toHaveAttribute('href', '/write')
    })

    test('offers only the desk tools and restores focus when dismissed', async ({
      page,
    }) => {
      test.skip(
        !process.env.PLAYWRIGHT_QA_EMAIL || !process.env.PLAYWRIGHT_QA_PASSWORD,
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
      await page.goto('/demo/write')
      await expect(
        page.getByText('Open your desk to begin a story or return to a draft.')
      ).toBeVisible()
      await expect(
        page.getByText('Sign in to save drafts and begin your own story.')
      ).toHaveCount(0)
      await page.locator('.writer-intro-finish').getByRole('link').click()

      const format = page.getByRole('button', { name: /Format/ })
      await format.click()
      const controls = page.getByRole('group', { name: 'Text formatting' })
      await expect(controls.getByRole('button')).toHaveCount(8)
      const panel = (await controls.boundingBox())!
      const trigger = (await format.boundingBox())!
      expect(panel.y).toBeGreaterThanOrEqual(trigger.y + trigger.height)
      expect(panel.x).toBeGreaterThanOrEqual(0)
      expect(panel.x + panel.width).toBeLessThanOrEqual(viewport.width)
      expect(panel.height).toBeLessThan(60)
      await controls.getByRole('button', { name: 'Link' }).click()
      await expect(
        page.getByRole('dialog', { name: 'Add a link' })
      ).toBeVisible()
      await page.keyboard.press('Escape')
      await expect(controls.getByRole('button', { name: 'Link' })).toBeFocused()
      await page.keyboard.press('Escape')
      await expect(controls).toBeHidden()
      await expect(format).toBeFocused()

      const body = page.locator('.writer-body[contenteditable=true]')
      await body.fill('A selection to keep')
      await body.press('ControlOrMeta+a')
      await expect
        .poll(() => page.evaluate(() => window.getSelection()?.toString()))
        .toBe('A selection to keep')
      await format.click()
      await controls.getByRole('button', { name: 'Bold' }).click()
      await expect(body.locator('strong')).toHaveText('A selection to keep')

      const insert = page.getByRole('button', { name: /Insert/ })
      await insert.click()
      const dialog = page.getByRole('dialog', { name: 'Add to your story' })
      await expect(dialog.getByRole('button', { name: /^Image/ })).toBeVisible()
      await expect(
        dialog.getByRole('button', { name: /^Divider/ })
      ).toBeVisible()
      await expect(dialog.getByRole('button', { name: /^Video/ })).toHaveCount(
        0
      )
      await page.keyboard.press('Escape')
      await expect(insert).toBeFocused()
      await insert.click()
      await dialog.getByRole('button', { name: /^Image/ }).click()
      await expect(
        page.getByRole('dialog', { name: 'Add an image' })
      ).toBeVisible()
      await page.keyboard.press('Escape')
      await expect(insert).toBeFocused()
      await expect(
        page.getByRole('button', { name: 'Private notes' })
      ).toHaveCount(0)
    })
  })
}

test('the sample card holds before continuing to the next stage', async ({
  page,
}) => {
  await page.goto('/demo/write')
  const hold = page.getByRole('button', { name: 'Hold demonstration' })
  await hold.click()
  const selected = page.getByRole('tab', { selected: true })
  const current = await selected.textContent()
  const next = current === 'Write' ? 'Publish' : 'Write'
  await page.getByRole('button', { name: `Continue to ${next}` }).click()
  await expect(selected).toHaveText(next)
  await expect(hold).toBeFocused()
})
