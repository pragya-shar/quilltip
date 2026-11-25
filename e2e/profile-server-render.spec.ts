import { test, expect } from '@playwright/test'
import { publishedArticlePath } from './helpers/published-article-path'

// The writer's name and first page of articles must come in the server HTML,
// not from the browser's Convex connection after the JavaScript loads.
test('writer page renders the profile and articles on the server', async ({
  page,
  browser,
}) => {
  await page.goto('/articles')
  const article = await publishedArticlePath(page)
  test.skip(!article, 'No published article on this backend to find a writer')
  const writer = `/${article!.split('/')[1]}`

  const context = await browser.newContext()
  try {
    const serverOnly = await context.newPage()
    // No app bundles and no live queries: only the HTML (and the small inline
    // scripts that place streamed HTML) can show content.
    await serverOnly.route('**/_next/static/**/*.js', (route) => route.abort())
    await serverOnly.routeWebSocket(/\/sync/, () => {})
    const response = await serverOnly.goto(writer)
    expect(response?.status()).toBe(200)
    const main = serverOnly.locator('main.writer-collection')
    await expect(main.getByRole('heading', { level: 1 })).not.toBeEmpty()
    await expect(main.locator('a.library-row').first()).toBeVisible()
    await expect(main.getByText('Loading articles…')).toHaveCount(0)
    // Rows carry only listing fields, not article bodies.
    expect(await response?.text()).not.toContain('"type":"doc"')
  } finally {
    await context.close()
  }

  // With JavaScript, live data takes over and the rows stay.
  await page.goto(writer)
  await expect(page.locator('main.writer-collection h1')).toBeVisible()
  await expect(page.locator('a.library-row').first()).toBeVisible()
})
