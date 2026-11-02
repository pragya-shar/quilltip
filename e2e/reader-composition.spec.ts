import { test, expect } from '@playwright/test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { ArticleReadNext } from '../components/articles/ArticleReadNext'

const articlePath =
  process.env.PLAYWRIGHT_HIGHLIGHT_ARTICLE ?? '/chris/untitled'

test('Read next excludes the current article, caps rows and uses supplied public openings', async ({
  page,
}) => {
  const row = (id: string) => ({
    id,
    title: `Article ${id}`,
    slug: id,
    username: 'writer',
    opening: `Opening ${id}.`,
  })
  await page.setContent(
    renderToStaticMarkup(
      createElement(ArticleReadNext, {
        currentArticleId: 'current',
        articles: [row('current'), row('one'), row('two'), row('three')],
      })
    )
  )
  const next = page.getByRole('navigation', { name: 'Read next' })
  await expect(next.getByRole('link')).toHaveCount(2)
  await expect(next.getByRole('link').first()).toHaveAttribute(
    'href',
    '/writer/one'
  )
  await expect(next.getByRole('link').first()).toContainText('“Opening one.”')
  await expect(next.getByText('Read more', { exact: true })).toHaveCount(2)
  await page.setContent(
    renderToStaticMarkup(
      createElement(ArticleReadNext, {
        currentArticleId: 'current',
        articles: [row('current')],
      })
    )
  )
  await expect(page.getByRole('navigation', { name: 'Read next' })).toHaveCount(
    0
  )
})

for (const viewport of [
  { width: 1440, height: 1000 },
  { width: 390, height: 844 },
]) {
  test(`reader composition and end matter at ${viewport.width}px`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport)
    const errors: string[] = []
    page.on('pageerror', (error) => errors.push(error.message))
    await page.goto(articlePath)
    const reader = page.locator('.reader-article')
    await expect(reader.locator('.published-prose')).toBeVisible()
    await expect(
      reader.locator(
        '.reader-cover, .reader-tags, .reader-metadata, .reader-share'
      )
    ).toHaveCount(0)
    const bounds = await reader.boundingBox()
    expect(bounds!.width).toBeCloseTo(viewport.width === 1440 ? 700 : 343.2, 0)
    const body = page.locator('.article-content')
    const originalText = await body.textContent()
    const originalHeadings = await body
      .locator('h2')
      .evaluateAll((nodes) =>
        nodes.map((n) => ({ id: n.id, text: n.textContent }))
      )
    const tip = page.locator('.reader-support')
    expect((await tip.boundingBox())!.y).toBeGreaterThan(
      (await body.boundingBox())!.y + (await body.boundingBox())!.height - 1
    )
    const dismiss = page.getByRole('button', { name: 'Dismiss reading tip' })
    await expect(dismiss).toBeVisible()
    await dismiss.click()
    await expect(dismiss).toHaveCount(0)
    expect(await body.textContent()).toBe(originalText)
    await page.reload()
    await expect(body.locator('.published-prose')).toBeVisible()
    await expect(dismiss).toHaveCount(0)
    expect(
      await body
        .locator('h2')
        .evaluateAll((nodes) =>
          nodes.map((n) => ({ id: n.id, text: n.textContent }))
        )
    ).toEqual(originalHeadings)
    const next = page.getByRole('navigation', { name: 'Read next' })
    await expect(next.getByRole('link')).toHaveCount(2)
    for (const link of await next.getByRole('link').all())
      expect(await link.getAttribute('href')).not.toBe(articlePath)
    await expect(
      page.getByRole('button', { name: 'Article details', exact: true })
    ).toHaveAttribute('aria-expanded', 'false')
    await page.locator('.reader-support button').click()
    await expect(page.getByRole('dialog').first()).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await expect(page.locator('.reader-support button')).toBeFocused()
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth
      )
    ).toBe(true)
    expect(errors).toEqual([])
    await page.getByRole('link', { name: '← Articles', exact: true }).click()
    await expect(page).toHaveURL(/\/articles$/)
  })
}
