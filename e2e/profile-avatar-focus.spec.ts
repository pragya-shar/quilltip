import { test, expect, type Page } from '@playwright/test'
import { avatarSourceRefusal } from '../lib/security/imageSources'

// The fixture's origin stands in for the deployment's file storage (#633).
const ORIGINAL = 'http://127.0.0.1:4176/api/storage/original.svg'
const NEW_PHOTO = 'http://127.0.0.1:4176/api/storage/new.svg'
const OUTSIDE = 'https://someone-else-456.convex.cloud/api/storage/photo.svg'

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
        await expect(avatar).toHaveAttribute('src', ORIGINAL)
        await openUrlDialog(page)
        await page.getByLabel('Image URL', { exact: true }).fill(NEW_PHOTO)
        await page.getByRole('button', { name: 'Save photo' }).click()
        await expect(trigger).toHaveAttribute('aria-busy', 'true')
        await dismiss(page, method)
        await expect(trigger).toBeFocused()

        // A focusable disabled control must block pointer and keyboard opening.
        await trigger.press('Enter')
        await expect(page.getByRole('menu')).toBeHidden()
        await trigger.press('Space')
        await expect(page.getByRole('menu')).toBeHidden()
        await trigger.press('ArrowDown')
        await expect(page.getByRole('menu')).toBeHidden()
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
          outcome === 'success' ? NEW_PHOTO : ORIGINAL
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
    await page.getByLabel('Image URL', { exact: true }).fill(NEW_PHOTO)
    await page.getByRole('button', { name: 'Save photo' }).click()
    await expect(page.getByRole('dialog')).toBeHidden()
    await expect(trigger).toBeFocused()
  })

  test('a photo address from another host is refused before saving (#633)', async ({
    page,
  }) => {
    let saves = 0
    await page.route('**/save', async (route) => {
      saves++
      await route.fulfill({ status: 200 })
    })
    await page.goto('/')
    const avatar = page.getByRole('img', { name: 'QA Writer' }).locator('img')
    await expect(avatar).toHaveAttribute('src', ORIGINAL)
    await openUrlDialog(page)
    await page.getByLabel('Image URL', { exact: true }).fill(OUTSIDE)
    await page.getByRole('button', { name: 'Save photo' }).click()
    await expect(page.getByText(avatarSourceRefusal(OUTSIDE))).toBeVisible()
    // The dialog stays open with the address, for the writer to change it.
    await expect(page.getByLabel('Image URL', { exact: true })).toHaveValue(
      OUTSIDE
    )
    await dismiss(page, 'Escape')
    expect(saves).toBe(0)
    await expect(avatar).toHaveAttribute('src', ORIGINAL)
  })
})
