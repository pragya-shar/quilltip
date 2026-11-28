import { expect, test } from '@playwright/test'

// /pocket on a production build with JavaScript off: who is here is known
// only after a script runs, so the server's own response asks to sign in,
// with no money and no placeholder that never fills.

test.skip(
  !process.env.NO_SCRIPT_CHECK,
  'Needs a production build (bun scripts/app-checks/run.ts)'
)

test('the first response of /pocket holds its title, a sign-in prompt and no money', async ({
  request,
}) => {
  const response = await request.get('/pocket')
  expect(response.status()).toBe(200)
  // The markup, without the scripts and the React payload in them (where
  // "$1" is a reference, not money).
  const html = (await response.text()).replace(/<script[\s\S]*?<\/script>/g, '')
  expect(html).toContain('Sign in to tip and keep your lines.')
  expect(html).toContain('href="/signin?returnTo=%2Fpocket"')
  // The balance's place, for a held session, with no figure in it yet.
  expect(html).toContain('data-when="held"')
  expect(html).not.toContain('Ready to tip')
  expect(html).not.toMatch(/\$\s?\d/)
  expect(html).not.toMatch(/Pocket</)
})

test('with no script, /pocket shows its title and Sign in, and no figures', async ({
  page,
}) => {
  await page.goto('/pocket')
  await expect(
    page.getByRole('heading', { level: 1, name: 'Balance' })
  ).toBeVisible()
  const prompt = page.locator(
    'main [data-session-switch] > [data-when="signed-out"]'
  )
  await expect(prompt).toBeVisible()
  await expect(prompt.getByRole('link', { name: 'Sign in' })).toHaveAttribute(
    'href',
    '/signin?returnTo=%2Fpocket'
  )
  await expect(
    page.locator('main [data-session-switch] > [data-when="held"]')
  ).toBeHidden()
  expect(await page.locator('main').innerText()).not.toMatch(/\$\s?\d/)
})
