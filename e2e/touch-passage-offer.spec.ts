import { test, expect, type Locator } from '@playwright/test'

const articlePath =
  process.env.PLAYWRIGHT_HIGHLIGHT_ARTICLE ?? '/chris/untitled'

test.use({
  hasTouch: true,
  isMobile: true,
  viewport: { width: 390, height: 844 },
})

// Select the first `words` words of the paragraph, as the browser does after a
// long press (one word) or a drag of the selection handles (more words).
async function selectWords(paragraph: Locator, words: number) {
  return paragraph.evaluate((element, count) => {
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT)
    const text = walker.nextNode() as Text | null
    if (!text) throw new Error('No text in the paragraph')
    const value = text.textContent ?? ''
    let end = 0
    for (let seen = 0; seen < count && end < value.length; ) {
      const next = value.indexOf(' ', end + 1)
      end = next === -1 ? value.length : next
      seen += 1
    }
    const range = document.createRange()
    range.setStart(text, 0)
    range.setEnd(text, end)
    const selection = window.getSelection()!
    selection.removeAllRanges()
    selection.addRange(range)
    document.dispatchEvent(new Event('selectionchange'))
    return range.toString()
  }, words)
}

test('a touch selection can grow before the passage slip opens', async ({
  page,
}) => {
  await page.goto(articlePath)
  const paragraph = page.locator('.highlightable-article .tiptap p').first()
  await expect(paragraph).toBeVisible()
  const slip = page.getByRole('dialog', {
    name: 'Create highlight',
    exact: true,
  })
  const offer = page.getByRole('button', {
    name: 'Keep these words',
    exact: true,
  })

  // Long press: the finger lifts with one word selected.
  await paragraph.dispatchEvent('touchstart')
  await selectWords(paragraph, 1)
  await paragraph.dispatchEvent('touchend')
  await expect(offer).toBeVisible()
  await expect(slip).toBeHidden()

  // The reader drags a handle; the page gets selection changes only.
  const passage = await selectWords(paragraph, 8)
  await expect(slip).toBeHidden()

  await offer.tap()
  await expect(slip).toBeVisible()
  await expect(slip.locator('blockquote')).toContainText(passage.trim())
  await expect(offer).toBeHidden()

  await page.keyboard.press('Escape')
  await expect(slip).toBeHidden()
})

test('a tap in the article withdraws the touch offer', async ({ page }) => {
  await page.goto(articlePath)
  const paragraph = page.locator('.highlightable-article .tiptap p').first()
  await expect(paragraph).toBeVisible()
  const offer = page.getByRole('button', {
    name: 'Keep these words',
    exact: true,
  })
  await paragraph.dispatchEvent('touchstart')
  await selectWords(paragraph, 4)
  await paragraph.dispatchEvent('touchend')
  await expect(offer).toBeVisible()
  await paragraph.dispatchEvent('touchstart')
  await expect(offer).toBeHidden()
})
