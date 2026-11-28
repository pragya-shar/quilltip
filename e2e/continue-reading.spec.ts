import { expect, test } from '@playwright/test'

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
