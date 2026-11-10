import { expect, test, type Locator } from '@playwright/test'

test.use({ trace: 'off' })

// Use a disposable author with two copies of the same article: one draft and
// one recently published so its card is in Articles. Use identical title,
// subtitle, prose and cover in both copies.
const email = process.env.PLAYWRIGHT_QA_EMAIL
const password = process.env.PLAYWRIGHT_QA_PASSWORD
const articlePath = process.env.PLAYWRIGHT_PREVIEW_ARTICLE

async function openingLayout(article: Locator) {
  return article.evaluate(async (root) => {
    await document.fonts.ready
    const header = root.querySelector('header')!
    const elements = [
      root.querySelector('h1')!,
      root.querySelector('.reader-subtitle')!,
      root.querySelector('.reader-byline')!,
      root.querySelector('.article-content p')!,
    ]
    const origin = header.getBoundingClientRect().top
    return elements.map((element) => {
      const { width, height, top } = element.getBoundingClientRect()
      const { fontFamily, fontSize, lineHeight, textAlign, whiteSpace } =
        getComputedStyle(element)
      return {
        width: Math.round(width),
        height: Math.round(height),
        top: Math.round(top - origin),
        fontFamily,
        fontSize,
        lineHeight,
        textAlign,
        whiteSpace,
      }
    })
  })
}

for (const viewport of [
  { width: 1440, height: 1000 },
  { width: 900, height: 1000 },
  { width: 768, height: 1024 },
  { width: 390, height: 844 },
]) {
  test(`draft and published previews match the reader opening at ${viewport.width}px`, async ({
    page,
  }) => {
    test.skip(
      !email || !password || !articlePath,
      'Requires a disposable author and matching draft and published fixtures.'
    )
    await page.setViewportSize(viewport)
    await page.goto('/login')
    await page.getByLabel('Email', { exact: true }).fill(email!)
    await page.getByLabel('Password', { exact: true }).fill(password!)
    await page.getByRole('button', { name: 'Log in', exact: true }).click()
    await page.waitForURL((url) => url.pathname !== '/login')

    await page.goto(articlePath!)
    const reader = page.locator('.reader-article')
    const title = (await reader
      .getByRole('heading', { level: 1 })
      .textContent())!
    const subtitle = (await reader.locator('.reader-subtitle').textContent())!
    const paragraph = (await reader
      .locator('.article-content p')
      .first()
      .textContent())!
    const byline = await reader.locator('.reader-byline').innerText()
    await expect(reader.locator('.reader-passage-rail')).toBeVisible()
    // The reading tip is a dismissible reader control outside the composition.
    await page.getByRole('button', { name: 'Dismiss reading tip' }).click()
    const readerLayout = await openingLayout(reader)

    await page.goto('/articles')
    const cardCover = page
      .getByRole('link', { name: `Read ${title}`, exact: true })
      .locator('img')
    await expect(cardCover).toHaveAttribute('src', /.+/)
    const coverSource = (await cardCover.getAttribute('src'))!
    for (const published of [false, true]) {
      await page.goto('/write?desk=writing')
      const desk = page.getByRole('dialog', { name: 'Your writing' })
      const entry = published
        ? desk
            .locator('.publication-row')
            .filter({ hasText: title })
            .getByRole('link', { name: 'Edit', exact: true })
        : desk.getByRole('link').filter({ hasText: title })
      await entry.click()
      await expect(
        page.getByRole('textbox', { name: 'Article title' })
      ).toHaveValue(title)
      const preview = page.getByRole('button', { name: /^Preview/ })
      await preview.click()
      const dialog = page.getByRole('dialog', { name: 'Article preview' })
      const article = dialog.locator('article')
      await expect(
        dialog.getByText('Your cover appears on article cards.')
      ).toBeVisible()
      // A cover belongs on cards. Images authored in the body still belong here.
      await expect
        .poll(() =>
          article
            .locator('img')
            .evaluateAll((images) =>
              images.map((image) => image.getAttribute('src'))
            )
        )
        .not.toContain(coverSource)
      await expect(article.getByRole('heading', { level: 1 })).toHaveText(title)
      await expect(article.locator('.reader-subtitle')).toHaveText(subtitle)
      await expect(article.locator('.reader-byline')).toHaveText(byline)
      await expect(article.locator('.article-content p').first()).toHaveText(
        paragraph
      )
      expect(
        await article.locator('.article-content p').first().textContent()
      ).toBe(paragraph)
      expect(await openingLayout(article)).toEqual(readerLayout)
      expect(
        await dialog.evaluate(
          (element) => element.scrollWidth <= element.clientWidth
        )
      ).toBe(true)

      await page.keyboard.press('Escape')
      await expect(preview).toBeFocused()
      await preview.click()
      await dialog
        .getByRole('button', {
          name: published ? 'Article settings' : 'Continue to publish ↗',
        })
        .click()
      const cover = page.locator('#cover-preview img')
      await expect(cover).toBeVisible()
      await expect(cover).toHaveAttribute('src', coverSource)
    }

    await page.goto('/write')
    await page.getByRole('button', { name: /^Preview/ }).click()
    const empty = page.getByRole('dialog', { name: 'Article preview' })
    await expect(
      empty.getByRole('heading', { name: 'Untitled draft' })
    ).toBeVisible()
    await expect(empty.locator('.reader-subtitle')).toHaveCount(0)
    await expect(
      empty.getByText('Your cover appears on article cards.')
    ).toHaveCount(0)
    await expect(empty.getByRole('img')).toHaveCount(0)
  })
}
