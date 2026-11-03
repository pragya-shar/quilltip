import { expect, test } from '@playwright/test'
import { publishedArticlePath } from './helpers/published-article-path'

test.use({ trace: 'off', screenshot: 'off', video: 'off' })

for (const viewport of [
  { width: 1440, height: 1000 },
  { width: 390, height: 844 },
]) {
  test.describe(`Collections at ${viewport.width}px`, () => {
    test.use({ viewport, reducedMotion: 'reduce' })

    test('a public writer lists their articles and links back to discovery', async ({
      page,
    }) => {
      await page.goto('/articles')
      const articlePath = await publishedArticlePath(page)
      test.skip(
        !articlePath,
        'Requires a published article in the QA deployment.'
      )
      const writerPath = articlePath!.slice(0, articlePath!.lastIndexOf('/'))
      await page.goto(writerPath)
      const main = page.getByRole('main')
      await expect(main.getByRole('heading', { level: 1 })).toBeVisible()
      await expect(main.getByText('Writer', { exact: true })).toBeVisible()
      await expect(main.getByRole('tablist')).toHaveCount(0)
      const articles = main.getByRole('link', { name: /^Read more/ })
      await expect(articles.first()).toBeVisible()
      for (const link of await articles.all()) {
        const href = await link.getAttribute('href')
        expect(href?.slice(0, href.lastIndexOf('/'))).toBe(writerPath)
      }

      await page.goto(`${writerPath}?page=999999`)
      await main.getByRole('link', { name: 'Return to the first page' }).click()
      await expect(page).toHaveURL(new URL(writerPath, page.url()).href)
      await expect(articles.first()).toBeVisible()
      await expect(
        main.getByRole('link', { name: '← Articles' })
      ).toHaveAttribute('href', '/articles')
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth)
      ).toBeLessThanOrEqual(viewport.width)
    })

    test('the signed-in library places static artwork behind its collection', async ({
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
      await page.goto('/library')
      const main = page.getByRole('main')
      await expect(
        main.getByRole('heading', { name: 'Your library.' })
      ).toBeVisible()
      await expect(
        main.getByRole('heading', { name: 'Bookmarked articles' })
      ).toBeVisible()
      await expect(
        main.getByRole('heading', { name: 'Your highlights' })
      ).toBeVisible()
      const backdrop = page.locator('.literary-scatter')
      await expect(backdrop).toHaveAttribute('aria-hidden', 'true')
      await expect(backdrop).toHaveCSS('pointer-events', 'none')
      const artwork = backdrop.locator('svg:visible').first()
      await expect(artwork).toBeVisible()
      await expect(artwork).toHaveCSS('animation-name', 'none')
      await main.getByRole('link', { name: '← Articles' }).press('Enter')
      await expect(page).toHaveURL(/\/articles$/)
      const articlePath = await publishedArticlePath(page)
      if (articlePath) {
        await page.goto(articlePath)
        const bookmark = page
          .getByRole('button', { name: /^Bookmark / })
          .first()
        await bookmark.click()
        await page.goto('/library')
        const saved = main
          .locator('.library-row')
          .filter({ has: page.locator('strong') })
          .first()
        await expect(saved).toHaveAttribute('href', articlePath)
        await saved.click()
        await expect(page).toHaveURL(new URL(articlePath, page.url()).href)
      }
    })
  })
}
