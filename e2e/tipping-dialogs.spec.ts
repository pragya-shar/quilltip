import { test, expect, type Page } from '@playwright/test'

async function openArticle(page: Page) {
  // A development backend may provide a stable article without creating content.
  if (process.env.PLAYWRIGHT_TIP_ARTICLE_PATH) {
    await page.goto(process.env.PLAYWRIGHT_TIP_ARTICLE_PATH)
  } else {
    await page.goto('/articles')
    await page
      .getByRole('link', { name: 'Read more', exact: true })
      .first()
      .click()
  }
  await expect(
    page.getByRole('button', { name: 'Tip article', exact: true })
  ).toBeVisible()
}

test('passage context and amount survive checkout, back and cancellation', async ({
  page,
}) => {
  test.skip(
    !process.env.PLAYWRIGHT_TIP_ARTICLE_PATH,
    'Select a development article with a receiving wallet using PLAYWRIGHT_TIP_ARTICLE_PATH.'
  )
  await openArticle(page)
  const paragraph = page.locator('.published-prose p').first()
  await paragraph.scrollIntoViewIfNeeded()
  const selectedText = await paragraph.evaluate((element) => {
    const text = document
      .createTreeWalker(element, NodeFilter.SHOW_TEXT)
      .nextNode()!
    const range = document.createRange()
    range.setStart(text, 0)
    range.setEnd(text, Math.min(text.textContent!.length, 45))
    const selection = window.getSelection()!
    selection.removeAllRanges()
    selection.addRange(range)
    document.dispatchEvent(new Event('selectionchange'))
    return range.toString()
  })
  await page
    .getByRole('button', { name: 'Highlight & tip', exact: true })
    .click()
  const dialog = page.getByTestId('highlight-tip-dialog')
  const context = dialog.getByRole('blockquote', { name: 'Selected passage' })
  await expect(context).toHaveText(selectedText)
  await dialog
    .getByRole('button', { name: /^(2)( test)? XLM$/, exact: true })
    .click()
  await dialog
    .getByRole('button', { name: 'Choose wallet', exact: true })
    .click()
  await expect(context).toHaveText(selectedText)
  await expect(dialog.getByText(/^2( test)? XLM$/)).toBeVisible()
  await dialog.getByRole('button', { name: 'Back', exact: true }).click()
  await expect(
    dialog.getByRole('button', { name: /^(2)( test)? XLM$/, exact: true })
  ).toHaveAttribute('aria-pressed', 'true')
  await dialog.getByRole('button', { name: 'Close', exact: true }).click()
  await expect(dialog).toBeHidden()
  await page
    .getByRole('button', { name: 'Highlight & tip', exact: true })
    .click()
  await dialog
    .getByRole('button', { name: 'Choose wallet', exact: true })
    .click()
  await dialog.getByRole('button', { name: 'Sign in to tip' }).click()
  await expect(page).toHaveURL(/\/login\?returnTo=/)
  expect(new URL(page.url()).searchParams.get('returnTo')).toBe(
    process.env.PLAYWRIGHT_TIP_ARTICLE_PATH
  )
})

test('article sign-in keeps the original article as its return destination', async ({
  page,
}) => {
  await openArticle(page)
  const articlePath = new URL(page.url()).pathname
  await page.getByRole('button', { name: 'Tip article', exact: true }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByRole('button', { name: /^2( test)? XLM$/ }).click()
  await dialog
    .getByRole('button', { name: 'Choose wallet', exact: true })
    .click()
  await dialog.getByRole('button', { name: 'Sign in to tip' }).click()
  await expect(page).toHaveURL(/\/login\?returnTo=/)
  expect(
    new URL(new URL(page.url()).searchParams.get('returnTo')!, page.url())
      .pathname
  ).toBe(articlePath)
  expect(
    new URL(
      new URL(page.url()).searchParams.get('returnTo')!,
      page.url()
    ).searchParams.get('tipXlm')
  ).toBe('2')
})

for (const [width, height] of [
  [390, 480],
  [390, 844],
  [1440, 1000],
] as const) {
  test(`article appreciation retains amount and note through checkout at ${width}×${height}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height })
    await openArticle(page)
    const trigger = page.getByRole('button', {
      name: 'Tip article',
      exact: true,
    })
    await trigger.click()
    const dialog = page.getByRole('dialog')
    await expect(
      dialog.getByRole('button', { name: 'Choose wallet', exact: true })
    ).toBeDisabled()
    await dialog
      .getByRole('button', { name: /^5( test)? XLM$/, exact: true })
      .click()
    await expect(
      dialog.getByRole('button', { name: /^5( test)? XLM$/, exact: true })
    ).toHaveAttribute('aria-pressed', 'true')
    await expect(dialog.getByLabel('Message to author (optional)')).toBeHidden()
    await dialog.getByText('Other tip options', { exact: true }).click()
    await dialog
      .getByLabel('Message to author (optional)')
      .fill('These words stayed with me.')
    await dialog
      .getByRole('button', { name: 'Choose wallet', exact: true })
      .click()
    await expect(dialog.getByText(/^5( test)? XLM$/)).toBeVisible()
    await expect(
      dialog.getByText('These words stayed with me.', { exact: false })
    ).toBeVisible()
    await expect(
      dialog.getByRole('button', { name: 'Sign in to tip' })
    ).toBeVisible()
    await dialog.getByRole('button', { name: 'Back', exact: true }).click()
    await expect(dialog.getByLabel('Message to author (optional)')).toHaveValue(
      'These words stayed with me.'
    )
    const amount = dialog.getByLabel('Or enter custom amount')
    await amount.fill('0')
    await dialog
      .getByRole('button', { name: 'Choose wallet', exact: true })
      .click()
    await expect(dialog.getByRole('alert')).toContainText(
      'Please select or enter a valid amount'
    )
    await amount.fill('2.75')
    await dialog
      .getByRole('button', { name: 'Choose wallet', exact: true })
      .click()
    await expect(dialog.getByText('$2.75', { exact: true })).toBeVisible()
    const bounds = await dialog.boundingBox()
    expect(bounds!.x).toBeGreaterThanOrEqual(0)
    expect(bounds!.width + bounds!.x).toBeLessThanOrEqual(width)
    await page.keyboard.press('Escape')
    await expect(dialog).toBeHidden()
    await expect(trigger).toBeFocused()
  })
}
