import { test, expect, type Page } from '@playwright/test'
import { publishedArticlePath } from './helpers/published-article-path'

// One shared header on reading, writer, article and help pages (guest view).
async function headerPaths(page: Page) {
  await page.goto('/articles')
  const article = await publishedArticlePath(page)
  const writer = article ? `/${article.split('/')[1]}` : null
  return ['/articles', '/support', ...(article ? [article, writer!] : [])]
}

test('guest pages share one header with Log in and Sign up', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 900 })
  for (const path of await headerPaths(page)) {
    await page.goto(path)
    const nav = page.getByRole('navigation', {
      name: 'Main navigation',
      exact: true,
    })
    await expect(nav, path).toHaveCount(1)
    await expect(page.locator('header.app-site-header'), path).toHaveCount(1)
    await expect(
      nav.getByRole('link', { name: 'Log in', exact: true }),
      path
    ).toBeVisible()
    await expect(
      nav.getByRole('link', { name: 'Sign up', exact: true }),
      path
    ).toBeVisible()
    await expect(
      nav.getByRole('button', { name: 'Account menu' }),
      path
    ).toHaveCount(0)
  }
  await page.goto('/articles')
  await expect(
    page
      .getByRole('navigation', { name: 'Main navigation', exact: true })
      .getByRole('link', { name: 'Articles', exact: true })
  ).toHaveAttribute('aria-current', 'page')
})

test('at 375px every shared header shows Menu on one line', async ({
  page,
}) => {
  await page.setViewportSize({ width: 375, height: 812 })
  for (const path of await headerPaths(page)) {
    await page.goto(path)
    const header = page.locator('header.app-site-header')
    await expect(
      page.getByRole('button', { name: 'Open navigation menu' }),
      path
    ).toBeVisible()
    const box = await header.boundingBox()
    expect(box?.height, `${path} header height`).toBeLessThanOrEqual(72)
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
      path
    ).toBeLessThanOrEqual(375)
  }
})
