import { expect, test } from '@playwright/test'

const articlePath = process.env.PLAYWRIGHT_RESUME_ARTICLE

for (const viewport of [
  { width: 1440, height: 1000 },
  { width: 390, height: 844 },
]) {
  test(`the reading room restores a saved article at ${viewport.width}px`, async ({
    page,
  }) => {
    test.skip(
      !articlePath,
      'Set PLAYWRIGHT_RESUME_ARTICLE to a long published article'
    )
    await page.setViewportSize(viewport)
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await page.goto('/articles')
    const strip = page
      .getByRole('complementary')
      .filter({ hasText: 'Continue reading' })
    await expect(strip).toHaveCount(0)

    await page.goto(articlePath!)
    const prose = page.locator('.published-prose')
    await expect(prose).toBeVisible()
    const title = await page.getByRole('heading', { level: 1 }).innerText()
    const offset = await prose.evaluate((el) => {
      const bounds = el.getBoundingClientRect()
      const top = Math.round(window.scrollY + bounds.top + bounds.height * 0.35)
      window.scrollTo({ top, behavior: 'instant' })
      return top
    })
    await expect
      .poll(() =>
        page.evaluate(() =>
          localStorage.getItem('quilltip:reading-progress:v1')
        )
      )
      .toMatch(/"ratio":0\./)
    await page.reload()
    await expect(prose).toBeVisible()
    await expect
      .poll(() => page.evaluate((y) => Math.abs(scrollY - y), offset))
      .toBeLessThan(30)
    await page.goBack()
    await expect(strip).toContainText(/Continue reading · \d+%/)
    const resume = strip.getByRole('link', { name: title })
    await expect(resume).toHaveAttribute('href', articlePath! + '?resume=1')
    await resume.focus()
    await page.keyboard.press('Enter')
    await expect(page).toHaveURL(/\?resume=1$/)
    await expect(prose).toBeVisible()
    await expect
      .poll(() => page.evaluate((y) => Math.abs(scrollY - y), offset))
      .toBeLessThan(30)
    await page.reload()
    await expect(prose).toBeVisible()
    await expect
      .poll(() => page.evaluate((y) => Math.abs(scrollY - y), offset))
      .toBeLessThan(30)
    await page.goBack()
    await expect(strip.getByRole('link', { name: title })).toBeVisible()
    await page
      .getByRole('region', { name: 'Articles', exact: true })
      .getByRole('link', { name: `Read ${title}`, exact: true })
      .click()
    await expect(prose).toBeVisible()
    await expect(page).toHaveURL((url) => !url.searchParams.has('resume'))
    await expect.poll(() => page.evaluate(() => scrollY)).toBeLessThan(30)
  })
}

test('resume waits for an uncached article image to take up space', async ({
  page,
}) => {
  const imageArticle = process.env.PLAYWRIGHT_RESUME_IMAGE_ARTICLE
  test.skip(
    !imageArticle,
    'Set PLAYWRIGHT_RESUME_IMAGE_ARTICLE to the image fixture'
  )

  let delayImage = false
  let releaseImage: () => void = () => {}
  const waitForRelease = new Promise<void>((resolve) => {
    releaseImage = resolve
  })
  await page.route('**/resume-layout-fixture.svg', async (route) => {
    if (delayImage) await waitForRelease
    await route.fulfill({
      contentType: 'image/svg+xml',
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="600" height="1000"><rect width="600" height="1000" fill="#cdd"/></svg>',
    })
  })

  await page.goto(imageArticle!)
  const prose = page.locator('.published-prose')
  const image = prose.getByRole('img', { name: 'Layout fixture' })
  await expect
    .poll(() => image.evaluate((node: HTMLImageElement) => node.naturalHeight))
    .toBe(1000)
  const offset = await prose.evaluate((el) => {
    const bounds = el.getBoundingClientRect()
    const top = Math.round(window.scrollY + bounds.top + bounds.height * 0.4)
    window.scrollTo({ top, behavior: 'instant' })
    return top
  })
  await expect
    .poll(() =>
      page.evaluate(() => localStorage.getItem('quilltip:reading-progress:v1'))
    )
    .toMatch(/"ratio":0\./)
  await page.getByRole('link', { name: '← Articles', exact: true }).click()
  delayImage = true
  await page
    .getByRole('complementary')
    .filter({ hasText: 'Continue reading' })
    .getByRole('link', { name: /Read more/ })
    .click()
  try {
    await expect
      .poll(() => image.evaluate((node: HTMLImageElement) => node.complete))
      .toBe(false)
    expect(await page.evaluate(() => scrollY)).toBeLessThan(30)
  } finally {
    releaseImage()
  }
  await expect
    .poll(() => page.evaluate((y) => Math.abs(scrollY - y), offset))
    .toBeLessThan(30)
})
