import { test, expect, type Page } from '@playwright/test'

// Generated passwords never reach traces, screenshots or video.
test.use({ trace: 'off', screenshot: 'off', video: 'off' })

for (const path of ['/settings', '/welcome']) {
  test(`signed-out ${path} goes to log in and keeps the destination`, async ({
    page,
  }) => {
    await page.goto(path)
    await expect(page).toHaveURL(
      (url) =>
        url.pathname === '/login' && url.searchParams.get('returnTo') === path
    )
  })
}

/**
 * The new-writer journey: signup, handle, bio, settings and the writer page.
 * It creates a throwaway account (example.test address, generated password),
 * so it runs only when PLAYWRIGHT_TEST_SIGNUP=1 points at a local or
 * development backend. Never run it against production.
 */
test.describe('new writer setup and profile settings', () => {
  test.skip(
    process.env.PLAYWRIGHT_TEST_SIGNUP !== '1',
    'Set PLAYWRIGHT_TEST_SIGNUP=1 with a local or development Convex backend.'
  )
  test.use({ viewport: { width: 375, height: 812 }, reducedMotion: 'reduce' })
  test.setTimeout(120_000)

  const run = Math.random().toString(36).slice(2, 8)
  const name = `Ines Test ${run}`
  const handle = `ines_test_${run}`

  async function signUp(page: Page, account: string) {
    await page.goto('/register?returnTo=%2Farticles')
    await page.getByLabel('Your name').fill(name)
    await page.getByLabel('Email').fill(`setup-${run}-${account}@example.test`)
    await page.getByLabel('Password', { exact: true }).fill(`Setup${run}Pass9`)
    await page.getByRole('button', { name: /Create account/ }).click()
    await expect(page).toHaveURL(
      (url) =>
        url.pathname === '/welcome' &&
        url.searchParams.get('next') === '/articles'
    )
  }

  test('handle, bio, settings and writer page', async ({ page }) => {
    await signUp(page, 'chooses')

    // Step 1: the suggestion comes from the name and is checked live.
    const field = page.getByLabel('Handle', { exact: true })
    await expect(field).toHaveValue(handle)
    await expect(page.getByRole('status')).toHaveText(
      `quilltip.me/${handle} is yours to take.`
    )
    await field.fill('settings')
    await expect(page.getByText('That handle is reserved.')).toBeVisible()
    await field.fill(handle)
    await page.getByRole('button', { name: 'Continue', exact: true }).click()

    // Step 2: optional photo and bio; the primary action continues to `next`.
    await expect(
      page.getByRole('heading', { name: 'Add a photo and a short bio' })
    ).toBeFocused()
    await expect(
      page.getByRole('button', { name: 'Change profile photo' })
    ).toBeVisible()
    await page.getByLabel(/Short bio/).fill('Notes on paper.')
    await page.getByRole('button', { name: 'Continue', exact: true }).click()
    await expect(page).toHaveURL(/\/articles$/)

    // Setup shows once.
    await page.goto('/welcome')
    await expect(page).toHaveURL(/\/write/)

    // Settings: inline errors, then a saved name and bio.
    await page.goto('/settings')
    const nameField = page.getByLabel('Display name', { exact: true })
    await expect(nameField).toHaveValue(name)
    await nameField.fill('')
    await page.getByRole('button', { name: 'Save profile' }).click()
    await expect(
      page.getByText('Enter the name readers will see.')
    ).toBeVisible()
    await expect(nameField).toBeFocused()
    await nameField.fill(`${name} Jr`)
    await page.getByLabel(/^Bio/).fill('Essays on paper and post.')
    await page.getByRole('button', { name: 'Save profile' }).click()
    await expect(page.getByText('Profile saved')).toBeVisible()

    // The writer page shows the saved profile and the owner's edit link.
    await page.getByRole('link', { name: /View public profile/ }).click()
    await expect(page).toHaveURL(new RegExp(`/${handle}$`))
    await expect(
      page.getByRole('heading', { level: 1, name: `${name} Jr` })
    ).toBeVisible()
    await expect(page.getByText('Essays on paper and post.')).toBeVisible()
    await expect(
      page.getByRole('link', { name: 'Edit profile' })
    ).toHaveAttribute('href', '/settings')
    await expect(
      page.getByText('Choose a handle so readers can find you')
    ).toHaveCount(0)
  })

  test('a writer who skips keeps a reminder on their own page', async ({
    page,
  }) => {
    await signUp(page, 'skips')
    // Leave setup without choosing: the generated handle stays.
    await page.getByRole('button', { name: 'Account menu' }).click()
    await page.getByRole('menuitem', { name: 'View profile' }).click()
    const banner = page.getByText('Choose a handle so readers can find you')
    await expect(banner).toBeVisible()
    await page.getByRole('button', { name: 'Dismiss handle reminder' }).click()
    await expect(banner).toHaveCount(0)
    await page.getByRole('link', { name: 'Edit profile' }).click()
    await expect(page).toHaveURL(/\/settings$/)
    await expect(
      page.getByRole('button', { name: 'Change handle' })
    ).toBeVisible()
  })
})
