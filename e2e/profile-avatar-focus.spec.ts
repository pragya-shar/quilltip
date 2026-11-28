import { test, expect, type Page } from '@playwright/test'

/**
 * The profile photo menu (#633): upload a photo, or remove the current one.
 * Photos are uploaded, never pasted. The fixture stands in for the upload
 * ingress and Convex; the editor, the upload request and Radix are real.
 *
 *   bun e2e/fixtures/avatar/server.mjs
 *   AVATAR_FIXTURES=1 PLAYWRIGHT_BASE_URL=http://127.0.0.1:4176 bunx playwright test e2e/profile-avatar-focus.spec.ts
 */

// The fixture's origin stands in for the deployment's file storage.
const ORIGINAL = 'http://127.0.0.1:4176/api/storage/original.svg'
const UPLOADED = 'http://127.0.0.1:4176/api/storage/uploaded.svg'
// A 1 px PNG: the editor compresses it in the browser before the upload.
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64'
)

const trigger = (page: Page) =>
  page.getByRole('button', { name: 'Change profile photo' })
const avatar = (page: Page) => page.getByRole('img', { name: 'QA Writer' })
const toasts = (page: Page, text: string) =>
  page.locator('[data-sonner-toast]').filter({ hasText: text })

/** Opens the menu from the keyboard. */
async function openMenu(page: Page) {
  await trigger(page).focus()
  await page.keyboard.press('Enter')
  const menu = page.getByRole('menu')
  await expect(menu).toBeVisible()
  return menu
}

/**
 * Enter on "Upload photo" clicks the editor's file input (checked by a
 * listener, not the browser's own file chooser, whose event is not reliable
 * here); the photo is then handed to that input.
 */
async function uploadByKeyboard(page: Page) {
  const input = page.locator('input[type="file"]')
  await input.evaluate((element) => {
    element.addEventListener('click', () => {
      ;(window as unknown as { __fileInputClicks: number }).__fileInputClicks =
        ((window as unknown as { __fileInputClicks?: number })
          .__fileInputClicks ?? 0) + 1
    })
  })
  await openMenu(page)
  await expect(
    page.getByRole('menuitem', { name: 'Upload photo' })
  ).toBeFocused()
  await page.keyboard.press('Enter')
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as unknown as { __fileInputClicks?: number })
            .__fileInputClicks ?? 0
      )
    )
    .toBe(1)
  await input.setInputFiles({
    name: 'photo.png',
    mimeType: 'image/png',
    buffer: PNG,
  })
}

test.describe('profile photo menu (#633)', () => {
  test.skip(
    process.env.AVATAR_FIXTURES !== '1',
    'Run bun e2e/fixtures/avatar/server.mjs and select its URL explicitly.'
  )
  test.use({ reducedMotion: 'reduce' })

  for (const width of [375, 1440]) {
    test.describe(`at ${width} px`, () => {
      test.use({ viewport: { width, height: 800 } })

      test('the menu offers upload and remove by keyboard, and returns focus', async ({
        page,
      }) => {
        await page.goto('/')
        await expect(avatar(page).locator('img')).toHaveAttribute(
          'src',
          ORIGINAL
        )
        const menu = await openMenu(page)
        await expect(menu).toHaveAccessibleName('Change profile photo')
        await expect(menu.getByRole('menuitem')).toHaveText([
          'Upload photo',
          'Remove photo',
        ])
        await expect(page.getByText('Paste image URL')).toHaveCount(0)
        await expect(
          page.getByRole('menuitem', { name: 'Upload photo' })
        ).toBeFocused()
        await page.keyboard.press('ArrowDown')
        await expect(
          page.getByRole('menuitem', { name: 'Remove photo' })
        ).toBeFocused()
        const box = await menu.boundingBox()
        expect(box!.x).toBeGreaterThanOrEqual(0)
        expect(box!.x + box!.width).toBeLessThanOrEqual(width)
        expect(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= window.innerWidth
          )
        ).toBe(true)
        await page.keyboard.press('Escape')
        await expect(menu).toBeHidden()
        await expect(trigger(page)).toBeFocused()
      })

      test('with no photo yet (the welcome step), the menu offers upload only', async ({
        page,
      }) => {
        await page.goto('/?photo=none')
        await expect(avatar(page)).toHaveText('Q')
        const menu = await openMenu(page)
        await expect(menu.getByRole('menuitem')).toHaveText(['Upload photo'])
        await page.keyboard.press('Escape')
        await expect(trigger(page)).toBeFocused()
      })

      test('an upload is announced once, shows the new photo and keeps focus', async ({
        page,
      }) => {
        let finish!: () => void
        const pending = new Promise<void>((resolve) => (finish = resolve))
        await page.route('**/upload', async (route) => {
          await pending
          await route.fulfill({ json: { storageId: 'fixture-storage-id' } })
        })
        await page.goto('/')
        await uploadByKeyboard(page)
        await expect(trigger(page)).toHaveAttribute('aria-busy', 'true')
        await expect(
          page.getByRole('status').filter({ hasText: 'Uploading your photo…' })
        ).toHaveCount(1)
        // Reduced motion: the busy icon does not spin.
        expect(
          await trigger(page)
            .locator('svg')
            .evaluate((icon) => getComputedStyle(icon).animationName)
        ).toBe('none')
        // While it runs, the trigger keeps focus and does not reopen the menu.
        await expect(trigger(page)).toBeFocused()
        await page.keyboard.press('Enter')
        await expect(page.getByRole('menu')).toBeHidden()
        finish()
        await expect(trigger(page)).toHaveAttribute('aria-busy', 'false')
        await expect(avatar(page).locator('img')).toHaveAttribute(
          'src',
          UPLOADED
        )
        await expect(toasts(page, 'Profile photo updated')).toHaveCount(1)
        await expect(
          page.getByRole('status').filter({ hasText: 'Uploading your photo…' })
        ).toHaveCount(0)
        await expect(trigger(page)).toBeFocused()
      })

      test('an upload that fails gives one error, keeps the photo and keeps focus', async ({
        page,
      }) => {
        await page.route('**/upload', (route) =>
          route.fulfill({ status: 500, body: 'unavailable' })
        )
        await page.goto('/')
        await uploadByKeyboard(page)
        await expect(
          toasts(page, 'Failed to upload file to storage')
        ).toHaveCount(1)
        await expect(trigger(page)).toHaveAttribute('aria-busy', 'false')
        await expect(avatar(page).locator('img')).toHaveAttribute(
          'src',
          ORIGINAL
        )
        await expect(trigger(page)).toBeFocused()
      })

      test('removing the photo is confirmed once and shows the initials', async ({
        page,
      }) => {
        await page.goto('/')
        await openMenu(page)
        await expect(
          page.getByRole('menuitem', { name: 'Upload photo' })
        ).toBeFocused()
        await page.keyboard.press('ArrowDown')
        await expect(
          page.getByRole('menuitem', { name: 'Remove photo' })
        ).toBeFocused()
        await page.keyboard.press('Enter')
        await expect(toasts(page, 'Profile photo removed')).toHaveCount(1)
        await expect(avatar(page)).toHaveText('Q')
        await expect(avatar(page).locator('img')).toHaveCount(0)
        await expect(trigger(page)).toBeFocused()
      })
    })
  }
})
