import { test, expect, type Page } from '@playwright/test'

const articlePath =
  process.env.PLAYWRIGHT_HIGHLIGHT_ARTICLE ?? '/chris/untitled'

async function selectPassage(page: Page, paragraphIndex = 0) {
  await page.waitForLoadState('networkidle')
  const paragraph = page
    .locator('.highlightable-article .tiptap p')
    .nth(paragraphIndex)
  await expect(paragraph).toBeVisible()
  await paragraph.scrollIntoViewIfNeeded()
  // Use the browser's native selection, as a keyboard reader would.
  await paragraph.evaluate((element) => {
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT)
    const text = walker.nextNode()!
    const range = document.createRange()
    range.setStart(text, 0)
    range.setEnd(text, Math.min(text.textContent!.length, 45))
    const selection = window.getSelection()!
    selection.removeAllRanges()
    selection.addRange(range)
    document.dispatchEvent(new Event('selectionchange'))
  })
  return page.getByRole('dialog').first()
}

test('guest passage controls stay reachable in a short, narrow viewport', async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 300 })
  await page.goto(articlePath)
  const dialog = await selectPassage(page)
  await expect(dialog).toBeVisible()
  const bounds = await dialog.boundingBox()
  expect(bounds!.x).toBeGreaterThanOrEqual(12)
  expect(bounds!.y).toBeGreaterThanOrEqual(12)
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(308)
  expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(288)
  await page.keyboard.press('Escape')
  await expect(dialog).toBeHidden()
  await expect(page.locator('.highlightable-article .tiptap')).toBeFocused()
  await selectPassage(page)
  const articleDetails = page.getByRole('button', {
    name: 'Article details',
    exact: true,
  })
  await articleDetails.click()
  await expect(dialog).toBeHidden()
  // Let the focus scope complete its deferred unmount restoration.
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
      )
  )
  await expect(articleDetails).toBeFocused()
})

test.describe('saved passages on a development backend', () => {
  test.skip(
    !process.env.PLAYWRIGHT_QA_EMAIL || !process.env.PLAYWRIGHT_QA_PASSWORD,
    'Provide a disposable development QA account through PLAYWRIGHT_QA_EMAIL and PLAYWRIGHT_QA_PASSWORD.'
  )

  test('tip-dialog backdrop keeps its passage panel and unsaved note', async ({
    page,
  }) => {
    await page.goto('/login')
    await page
      .getByLabel('Email', { exact: true })
      .fill(process.env.PLAYWRIGHT_QA_EMAIL!)
    await page
      .getByLabel('Password', { exact: true })
      .fill(process.env.PLAYWRIGHT_QA_PASSWORD!)
    await page.getByRole('button', { name: 'Log in', exact: true }).click()
    await expect(page).toHaveURL(/\/$/)
    await page.goto(articlePath)
    await expect(
      page.getByRole('button', { name: 'Account', exact: true })
    ).toBeVisible()
    const create = await selectPassage(page)
    await create.getByRole('button', { name: 'Add note', exact: true }).click()
    await create
      .getByLabel('Highlight note')
      .fill('Keep this unsaved passage note')
    await create
      .getByRole('button', { name: 'Tip passage', exact: true })
      .click()
    const tip = page.getByRole('dialog', { name: /^Support / })
    await expect(tip).toBeVisible()
    await page.mouse.click(5, 200)
    await expect(tip).toBeHidden()
    await expect(create).toBeVisible()
    await expect(create.getByLabel('Highlight note')).toHaveValue(
      'Keep this unsaved passage note'
    )
  })

  test('owner can save, edit and clear a note without losing the exact passage', async ({
    page,
  }) => {
    test.setTimeout(90_000)
    await page.goto('/login')
    await page
      .getByLabel('Email', { exact: true })
      .fill(process.env.PLAYWRIGHT_QA_EMAIL!)
    await page
      .getByLabel('Password', { exact: true })
      .fill(process.env.PLAYWRIGHT_QA_PASSWORD!)
    await page.getByRole('button', { name: 'Log in', exact: true }).click()
    await expect(page).toHaveURL(/\/$/)
    await page.goto(articlePath)
    await expect(
      page.getByRole('button', { name: 'Account', exact: true })
    ).toBeVisible()
    const create = await selectPassage(page)
    await expect(create).toBeVisible()
    await expect(
      create.getByRole('button', { name: /^Select .* highlight$/ })
    ).toHaveCount(6)
    await create
      .getByRole('button', { name: 'Select Emerald highlight' })
      .click()
    await expect(
      create.getByRole('button', { name: 'Select Emerald highlight' })
    ).toHaveAttribute('aria-pressed', 'true')
    await create.getByRole('button', { name: 'Add note', exact: true }).click()
    const note = `QA passage note ${Date.now()}`
    await create.getByLabel('Highlight note').fill(note)
    await create
      .getByRole('button', { name: 'Save highlight', exact: true })
      .click()
    await expect(create).toBeHidden()
    await page.reload()
    const mark = page
      .locator('mark[data-highlight-id]')
      .filter({ hasText: 'Ancient architecture is a remarkable reflecti' })
      .first()
    await expect(mark).toBeVisible()
    const passage = await mark.innerText()
    await mark.click()
    const details = page.getByRole('dialog', {
      name: 'Highlight details',
      exact: true,
    })
    await expect(details.getByText(note, { exact: true })).toBeVisible()
    await details
      .getByRole('button', { name: 'Edit Note', exact: true })
      .click()
    await details.getByLabel('Highlight note').fill('')
    await details
      .getByRole('button', { name: 'Save note', exact: true })
      .click()
    await expect(
      details.getByText('No note added', { exact: true })
    ).toBeVisible()
    const deleteButton = details.getByRole('button', {
      name: 'Delete Highlight',
      exact: true,
    })
    await deleteButton.click()
    const confirmation = page.getByRole('alertdialog', {
      name: 'Delete this highlight?',
    })
    await expect(confirmation).toBeVisible()
    await confirmation
      .getByRole('button', { name: 'Cancel', exact: true })
      .click()
    await expect(confirmation).toBeHidden()
    await expect(deleteButton).toBeFocused()
    await details
      .getByRole('button', { name: 'Close highlight details' })
      .click()
    await page.reload()
    await expect(mark).toHaveText(passage)
    await mark.click()
    await expect(
      details.getByText('No note added', { exact: true })
    ).toBeVisible()
  })

  test('private note survives a failed save and reload; note links and non-owner controls remain correct', async ({
    page,
  }) => {
    test.setTimeout(90_000)
    let rejectNextCreate = true
    await page.routeWebSocket(/\.convex\.cloud\//, (socket) => {
      const server = socket.connectToServer()
      socket.onMessage((message) => {
        const data = JSON.parse(message.toString())
        if (
          rejectNextCreate &&
          data.type === 'Mutation' &&
          data.udfPath === 'highlights:createHighlight'
        ) {
          rejectNextCreate = false
          socket.send(
            JSON.stringify({
              type: 'MutationResponse',
              requestId: data.requestId,
              success: false,
              result: 'QA simulated save failure',
              logLines: [],
            })
          )
        } else server.send(message)
      })
    })
    await page.goto('/login')
    await page
      .getByLabel('Email', { exact: true })
      .fill(process.env.PLAYWRIGHT_QA_EMAIL!)
    await page
      .getByLabel('Password', { exact: true })
      .fill(process.env.PLAYWRIGHT_QA_PASSWORD!)
    await page.getByRole('button', { name: 'Log in', exact: true }).click()
    await expect(page).toHaveURL(/\/$/)
    await page.goto(articlePath)
    await expect(
      page.getByRole('button', { name: 'Account', exact: true })
    ).toBeVisible()
    await page.setViewportSize({ width: 320, height: 500 })
    const create = await selectPassage(page, 6)
    await create
      .getByRole('button', { name: 'Public highlight', exact: true })
      .click()
    await create.getByRole('button', { name: 'Add note', exact: true }).click()
    const note = `Private QA ${Date.now()} ${'LongNoteWithoutSpaces'.repeat(35)}`
    await create.getByLabel('Highlight note').fill(note)
    const save = create.getByRole('button', {
      name: 'Save highlight',
      exact: true,
    })
    await save.click()
    await expect(
      page.getByText('Failed to create highlight', { exact: true })
    ).toBeVisible()
    await expect(create.getByLabel('Highlight note')).toHaveValue(note)
    await expect(
      create.getByRole('button', { name: 'Public highlight' })
    ).toHaveAttribute('aria-pressed', 'false')
    await save.click()
    await expect(create).toBeHidden()
    await page.reload()
    await page
      .getByRole('button', { name: 'Article details', exact: true })
      .click()
    const noteLink = page
      .getByRole('button', { name: /^Go to passage:/ })
      .filter({ hasText: note })
    await expect(noteLink).toContainText('Private · Only you')
    await noteLink.click()
    const privateMark = page
      .locator('mark[data-highlight-id]')
      .filter({ hasText: 'Preserving and studying ancient architecture' })
      .first()
    await expect(privateMark).toBeInViewport()
    await privateMark.click()
    const details = page.getByRole('dialog', {
      name: 'Highlight details',
      exact: true,
    })
    await expect(details.getByText('Private', { exact: true })).toBeVisible()
    await expect(details.getByText(note, { exact: true })).toBeVisible()
    const bounds = await details.boundingBox()
    expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(488)
    await page.keyboard.press('Escape')
    await expect(page.locator('.highlightable-article .tiptap')).toBeFocused()
    await page
      .locator('mark[data-highlight-id]')
      .filter({
        hasText:
          'the Egyptian pyramids were built using massive limestone blocks',
      })
      .first()
      .click()
    await expect(details).toBeVisible()
    await expect(
      details.getByRole('button', { name: 'Edit Note', exact: true })
    ).toHaveCount(0)
    await expect(
      details.getByRole('button', { name: 'Delete Highlight', exact: true })
    ).toHaveCount(0)
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth)
    ).toBeLessThanOrEqual(320)
  })
})

test('heatmap time ranges and empty states fit the reader at narrow and desktop sizes', async ({
  page,
}) => {
  await page.goto(articlePath)
  await page
    .getByRole('button', { name: 'Article details', exact: true })
    .click()
  const heatmap = page.getByRole('region', {
    name: 'Highlight heatmap',
    exact: true,
  })
  await expect(
    heatmap.getByRole('button', { name: 'All time' })
  ).toHaveAttribute('aria-pressed', 'true')
  await expect(heatmap.getByRole('status')).toHaveCount(0)
  const baseline = await heatmap.innerText()
  await heatmap.getByRole('button', { name: 'Last 7 days' }).click()
  await expect(
    heatmap.getByRole('button', { name: 'Last 7 days' })
  ).toHaveAttribute('aria-pressed', 'true')
  await expect(
    heatmap.getByText('No highlight tips in the last 7 days')
  ).toBeVisible()
  await heatmap.getByRole('button', { name: 'All time' }).click()
  await expect(heatmap).toHaveText(baseline, { useInnerText: true })
  for (const width of [320, 390, 1280]) {
    await page.setViewportSize({ width, height: 700 })
    await heatmap.scrollIntoViewIfNeeded()
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth)
    ).toBeLessThanOrEqual(width)
  }
})

for (const authPath of ['login', 'register']) {
  test(`guest prompt preserves passage intent on the ${authPath} path`, async ({
    page,
  }) => {
    // All current published authors have wallets. Override only that external
    // query field to exercise the real reader's no-wallet guest branch.
    await page.routeWebSocket(/\.convex\.cloud\//, (socket) => {
      const server = socket.connectToServer()
      server.onMessage((message) => {
        const data = JSON.parse(message.toString())
        for (const modification of data.modifications ?? []) {
          if (
            modification.type === 'QueryUpdated' &&
            modification.value?.author
          ) {
            modification.value.author.stellarAddress = null
          }
        }
        socket.send(JSON.stringify(data))
      })
    })
    const returnPath = `${articlePath}?reader=notes`
    await page.goto(returnPath)
    const dialog = await selectPassage(page)
    await expect(
      page.getByRole('heading', {
        name: 'Sign in to save highlights',
        exact: true,
      })
    ).toBeVisible()
    const link = dialog.getByRole('link', {
      name: authPath === 'login' ? 'Sign in' : 'Create a free account',
      exact: true,
    })
    await link.click()
    await expect(page).toHaveURL(new RegExp(`/${authPath}\\?returnTo=`))
    expect(new URL(page.url()).searchParams.get('returnTo')).toBe(returnPath)
    const selection = await page.evaluate(() =>
      JSON.parse(sessionStorage.getItem('quilltip:pendingHighlightSelection')!)
    )
    expect(selection.articleId).toBeTruthy()
    expect(selection.highlightText).toBe(
      'Ancient architecture is a remarkable reflecti'
    )
    expect(selection.endOffset - selection.startOffset).toBe(45)
    if (
      authPath === 'login' &&
      process.env.PLAYWRIGHT_QA_EMAIL &&
      process.env.PLAYWRIGHT_QA_PASSWORD
    ) {
      await page
        .getByLabel('Email', { exact: true })
        .fill(process.env.PLAYWRIGHT_QA_EMAIL)
      await page
        .getByLabel('Password', { exact: true })
        .fill(process.env.PLAYWRIGHT_QA_PASSWORD)
      await page.getByRole('button', { name: 'Log in', exact: true }).click()
      await expect(page).toHaveURL(
        new URL(
          returnPath,
          process.env.PLAYWRIGHT_BASE_URL ?? 'http://127.0.0.1:3100'
        ).href
      )
      await expect(
        page.getByRole('dialog', { name: 'Create highlight' })
      ).toBeVisible()
      await expect(
        page.getByRole('dialog', { name: 'Create highlight' })
      ).toContainText(selection.highlightText)
    }
  })
}
