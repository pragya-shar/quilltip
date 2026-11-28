import { test, expect, type Locator, type Page } from '@playwright/test'

/**
 * Passage selection on a touch screen (#665). A long press selects one word
 * and the finger lifts; the reader then drags the selection handles. The
 * passage slip must not open at the first step.
 *
 * What this proves: the reader's state machine for this event order, with
 * synthetic touch events and a scripted Range, on the real article reader
 * (the passage-touch fixture, no backend). What it does not prove: a real
 * long press, a real handle drag, or whether the offer covers a handle.
 * Those are checked by hand in Safari on the iOS Simulator.
 *
 *   bun e2e/fixtures/passage-touch/server.mjs
 *   PASSAGE_TOUCH_FIXTURES=1 bunx playwright test --config e2e/fixtures/passage-touch/playwright.config.ts
 */
test.skip(
  process.env.PASSAGE_TOUCH_FIXTURES !== '1',
  'Start e2e/fixtures/passage-touch/server.mjs and set PASSAGE_TOUCH_FIXTURES=1.'
)

// Select the first `words` words of the paragraph, as the browser does after
// a long press (one word) or a drag of the selection handles (more words).
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

async function open(page: Page, query = '') {
  await page.goto(`/${query}`)
  const paragraph = page.locator('.highlightable-article .tiptap p').first()
  await expect(paragraph).toBeVisible()
  return {
    paragraph,
    slip: page.getByRole('dialog', { name: 'Create highlight', exact: true }),
    offer: page.getByRole('button', { name: 'Keep these words', exact: true }),
  }
}

/** A long press: the finger lands, one word is selected, the finger lifts. */
async function longPress(paragraph: Locator, end: 'touchend' | 'touchcancel') {
  await paragraph.dispatchEvent('touchstart')
  await selectWords(paragraph, 1)
  await paragraph.dispatchEvent(end)
}

for (const [who, query] of [
  ['signed out', ''],
  ['signed in', '?auth=in'],
] as const) {
  test(`${who}: a long press does not open the passage slip; the offer opens it with the grown selection`, async ({
    page,
  }) => {
    const { paragraph, slip, offer } = await open(page, query)
    await longPress(paragraph, 'touchend')
    // The defect: the slip opened here with one word, over the handles.
    await expect(slip).toBeHidden()
    await expect(offer).toBeVisible()

    // The handles move; the page sees selection changes only.
    const passage = await selectWords(paragraph, 8)
    await expect(slip).toBeHidden()
    await expect(offer).toBeVisible()

    await offer.tap()
    await expect(slip).toBeVisible()
    await expect(slip.locator('blockquote')).toContainText(passage.trim())
    await expect(offer).toBeHidden()
    await page.keyboard.press('Escape')
    await expect(slip).toBeHidden()
  })
}

test('a long press that ends in a touch cancel still offers the passage', async ({
  page,
}) => {
  const { paragraph, slip, offer } = await open(page)
  await longPress(paragraph, 'touchcancel')
  await expect(slip).toBeHidden()
  await expect(offer).toBeVisible()
})

test('a tap in the article withdraws the offer', async ({ page }) => {
  const { paragraph, offer } = await open(page)
  await longPress(paragraph, 'touchend')
  await expect(offer).toBeVisible()
  await paragraph.dispatchEvent('touchstart')
  await expect(offer).toBeHidden()
})

test('a tap outside the article withdraws the offer, so no stale words open', async ({
  page,
}) => {
  const { paragraph, slip, offer } = await open(page)
  await longPress(paragraph, 'touchend')
  await expect(offer).toBeVisible()
  // A tap outside clears the page's selection; the editor keeps its own.
  await page.getByText('Below the article.').tap()
  await page.evaluate(() => window.getSelection()?.removeAllRanges())
  await expect(offer).toBeHidden()
  await expect(slip).toBeHidden()
})

test('a long press that ends in a pointer cancel still offers the passage', async ({
  page,
}) => {
  const { paragraph, slip, offer } = await open(page)
  await paragraph.dispatchEvent('touchstart')
  await selectWords(paragraph, 1)
  await page.evaluate(() =>
    document.dispatchEvent(new PointerEvent('pointercancel', { bubbles: true }))
  )
  await expect(slip).toBeHidden()
  await expect(offer).toBeVisible()
})

test('a press on the offer that clears the selection still opens the slip with the passage', async ({
  page,
}) => {
  const { paragraph, slip, offer } = await open(page)
  await longPress(paragraph, 'touchend')
  const passage = await selectWords(paragraph, 6)
  await expect(offer).toBeVisible()
  // Some browsers clear the native selection when the button is pressed.
  // Wait for the selectionchange event itself, not a frame: it is its own
  // task, so a frame can pass before it is dispatched.
  await offer.evaluate(
    (button) =>
      new Promise((resolve) => {
        document.addEventListener('selectionchange', () => resolve(null), {
          once: true,
        })
        button.dispatchEvent(
          new PointerEvent('pointerdown', {
            bubbles: true,
            pointerType: 'touch',
          })
        )
        window.getSelection()?.removeAllRanges()
      })
  )
  await expect(offer).toBeVisible()
  await offer.click()
  await expect(slip).toBeVisible()
  await expect(slip.locator('blockquote')).toContainText(passage.trim())
})
