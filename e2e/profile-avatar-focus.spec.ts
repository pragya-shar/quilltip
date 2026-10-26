import { test, expect, type Page } from '@playwright/test'

async function openUrlDialog(page: Page) {
  await page
    .getByRole('button', { name: 'Change profile photo' })
    .press('Enter')
  await page.getByRole('menuitem', { name: 'Paste image URL' }).click()
  await expect(page.getByLabel('Image URL', { exact: true })).toBeFocused()
}

async function dismiss(page: Page, method: string) {
  if (method === 'Escape') await page.keyboard.press('Escape')
  else await page.getByRole('button', { name: method, exact: true }).click()
  await expect(page.getByRole('dialog')).toBeHidden()
}

test.describe('profile avatar focus during a URL save', () => {
  test.skip(
    process.env.AVATAR_FIXTURES !== '1',
    'Run bun e2e/fixtures/avatar/server.mjs and select its URL explicitly.'
  )
  test.use({ reducedMotion: 'reduce' })

  for (const method of ['Cancel', 'Escape', 'Close']) {
    for (const outcome of ['success', 'failure']) {
      test(`${method} restores focus during slow ${outcome}`, async ({
        page,
      }) => {
        let finish!: () => void
        const pending = new Promise<void>((resolve) => (finish = resolve))
        let saves = 0
        await page.route('**/save', async (route) => {
          saves++
          await pending
          await route.fulfill({ status: outcome === 'success' ? 200 : 500 })
        })
        await page.goto('/')
        const trigger = page.getByRole('button', {
          name: 'Change profile photo',
          includeHidden: true,
        })
        const avatar = page
          .getByRole('img', { name: 'QA Writer' })
          .locator('img')
        await expect(avatar).toHaveAttribute('src', '/original.svg')
        await openUrlDialog(page)
        await page
          .getByLabel('Image URL', { exact: true })
          .fill(new URL('/new.svg', page.url()).href)
        await page.getByRole('button', { name: 'Save photo' }).click()
        await expect(trigger).toHaveAttribute('aria-busy', 'true')
        await dismiss(page, method)
        await expect(trigger).toBeFocused()

        // A focusable disabled control must block pointer and keyboard opening.
        await trigger.press('Enter')
        await trigger.press('Space')
        await trigger.press('ArrowDown')
        await page.mouse.click(
          ...(await trigger.evaluate((element) => {
            const box = element.getBoundingClientRect()
            return [box.x + box.width / 2, box.y + box.height / 2] as const
          }))
        )
        await expect(page.getByRole('menu')).toBeHidden()
        await page.keyboard.press('Tab')
        const next = page.getByRole('link', { name: 'Read articles' })
        await expect(next).toBeFocused()
        finish()
        await expect(trigger).toHaveAttribute('aria-busy', 'false')
        await expect(next).toBeFocused() // Completion must not steal focus.
        expect(saves).toBe(1)
        await expect(avatar).toHaveAttribute(
          'src',
          outcome === 'success'
            ? new URL('/new.svg', page.url()).href
            : '/original.svg'
        )
        await page.keyboard.press('Shift+Tab')
        await expect(trigger).toBeFocused()
        await openUrlDialog(page)
        await dismiss(page, 'Escape')
        await expect(trigger).toBeFocused()
      })
    }
  }

  test('normal dismissal and automatic save completion return focus', async ({
    page,
  }) => {
    await page.goto('/')
    const trigger = page.getByRole('button', { name: 'Change profile photo' })
    for (const method of ['Cancel', 'Escape', 'Close']) {
      await openUrlDialog(page)
      await dismiss(page, method)
      await expect(trigger).toBeFocused()
    }
    await openUrlDialog(page)
    await page
      .getByLabel('Image URL', { exact: true })
      .fill(new URL('/new.svg', page.url()).href)
    await page.getByRole('button', { name: 'Save photo' }).click()
    await expect(page.getByRole('dialog')).toBeHidden()
    await expect(trigger).toBeFocused()
  })
})
