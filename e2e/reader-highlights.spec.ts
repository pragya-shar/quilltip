import { test, expect, type Page } from '@playwright/test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { HighlightNotes } from '../components/highlights/HighlightNotes'
import type { Id } from '../convex/_generated/dataModel'

const articlePath =
  process.env.PLAYWRIGHT_HIGHLIGHT_ARTICLE ?? '/chris/untitled'

test('notes on the same passage expose distinct content, authors, privacy and tips', async ({
  page,
}) => {
  // Render the production component with fixed data: no backend writes, account
  // credentials or live tip history are needed to verify accessible names.
  const passage = 'The words we keep'
  const highlights = [
    { note: 'A public reflection', userName: 'Reader One', isPublic: true },
    { note: 'A private reminder', userName: 'Reader Two', isPublic: false },
    { note: 'A supported idea', userName: 'Reader Three', isPublic: true },
  ].map((highlight, index) => ({
    ...highlight,
    _id: `note-${index}` as Id<'highlights'>,
    highlightId: `passage-${index}`,
    userId: `reader-${index}` as Id<'users'>,
    text: passage,
    createdAt: Date.UTC(2026, 9, 23),
  }))
  await page.setContent(
    renderToStaticMarkup(
      createElement(HighlightNotes, {
        highlights,
        currentUserId: highlights[1]!.userId,
        tipsByHighlight: { 'passage-2': { count: 2, totalUsd: 1.5 } },
      })
    )
  )

  const publicNote = page.getByRole('button', { name: /A public reflection/ })
  const privateNote = page.getByRole('button', { name: /A private reminder/ })
  const tippedNote = page.getByRole('button', { name: /A supported idea/ })
  await expect(publicNote).toHaveAccessibleName(
    /Reader One.*The words we keep.*A public reflection.*Public note.*View passage/
  )
  await expect(privateNote).toHaveAccessibleName(
    /Reader Two \(You\).*The words we keep.*A private reminder.*Private · Only you.*View passage/
  )
  await expect(tippedNote).toHaveAccessibleName(
    /Reader Three.*The words we keep.*A supported idea.*Public note.*2 tips · \$1\.50.*View passage/
  )
})

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

test('keyboard selection keeps a full long quote and paper controls fit desktop and mobile', async ({
  page,
}) => {
  await page.goto(articlePath)
  const editor = page.locator('.highlightable-article .tiptap')
  await expect(editor).toBeVisible()
  await editor.focus()
  // Establish a caret in the read-only prose, then extend it with the keyboard.
  await editor
    .locator('p')
    .first()
    .evaluate((element) => {
      const range = document.createRange()
      range.setStart(element.firstChild!, 0)
      range.collapse(true)
      const selection = window.getSelection()!
      selection.removeAllRanges()
      selection.addRange(range)
    })
  await page.keyboard.press('ControlOrMeta+Shift+ArrowDown')
  const dialog = page.getByRole('dialog', {
    name: 'Create highlight',
    exact: true,
  })
  await expect(dialog).toBeVisible()
  const quote = await dialog.locator('blockquote').innerText()
  expect(quote.length).toBeGreaterThan(150)
  expect(quote).toContain('technological advancements.')
  for (const size of [
    { width: 1440, height: 1000 },
    { width: 390, height: 844 },
    { width: 320, height: 300 },
  ]) {
    await page.setViewportSize(size)
    const bounds = await dialog.boundingBox()
    expect(bounds!.x).toBeGreaterThanOrEqual(12)
    expect(bounds!.y).toBeGreaterThanOrEqual(12)
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(size.width - 12)
    expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(size.height - 12)
    await dialog
      .getByRole('button', { name: 'Highlight only', exact: true })
      .scrollIntoViewIfNeeded()
    await expect(
      dialog.getByRole('button', { name: 'Highlight only', exact: true })
    ).toBeInViewport()
    await expect(dialog.locator('blockquote')).toHaveText(quote)
  }
  await page.keyboard.press('Escape')
  await expect(editor).toBeFocused()
  await editor.press('ControlOrMeta+Shift+End')
  await expect(dialog).toBeVisible()
  const fullQuote = await dialog.locator('blockquote').innerText()
  expect(fullQuote).toContain('Ancient architecture is a remarkable reflection')
  expect(fullQuote).toMatch(/for generations to come\.$/)
  expect(fullQuote).not.toContain('Share this article')
  await page.keyboard.press('Escape')
})

test('guest free saving works for a wallet-enabled author and retains words when session storage fails', async ({
  page,
}) => {
  await page.goto(articlePath)
  const create = await selectPassage(page)
  await expect(
    create.getByRole('button', { name: 'Highlight & tip', exact: true })
  ).toBeVisible()
  await create
    .getByRole('button', { name: 'Highlight only', exact: true })
    .click()
  const dialog = page.getByRole('dialog', {
    name: 'Sign in to save highlights',
    exact: true,
  })
  await page.evaluate(() => {
    Storage.prototype.setItem = () => {
      throw new Error('Storage unavailable')
    }
  })
  await dialog.getByRole('link', { name: 'Sign in', exact: true }).click()
  await expect(dialog.getByRole('alert')).toContainText(
    'Your words are still here'
  )
  await expect(page).toHaveURL(new RegExp(articlePath))
})

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
  await page.mouse.click(5, 150)
  await expect(dialog).toBeHidden()
  await articleDetails.click()
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

  test('guest tip auth preserves return state and amount through storage and save failures', async ({
    page,
  }) => {
    test.setTimeout(90000)
    let reject = true
    await page.routeWebSocket(/\.convex\.cloud\//, (socket) => {
      const server = socket.connectToServer()
      socket.onMessage((message) => {
        const data = JSON.parse(message.toString())
        if (
          reject &&
          data.type === 'Mutation' &&
          data.udfPath === 'highlights:createHighlight'
        ) {
          reject = false
          socket.send(
            JSON.stringify({
              type: 'MutationResponse',
              requestId: data.requestId,
              success: false,
              result: 'QA prerequisite save failure',
              logLines: [],
            })
          )
        } else server.send(message)
      })
    })
    const returnPath = `${articlePath}?reader=notes#passage`
    await page.goto(returnPath)
    const create = await selectPassage(page, 4)
    await create
      .getByRole('button', { name: 'Highlight & tip', exact: true })
      .click()
    const tip = page.getByTestId('highlight-tip-dialog')
    await tip.getByRole('button', { name: '50¢', exact: true }).click()
    await tip.getByRole('button', { name: 'Continue', exact: true }).click()
    await page.evaluate(() => {
      Object.defineProperty(sessionStorage, 'setItem', {
        configurable: true,
        value: () => {
          throw new Error('Storage unavailable')
        },
      })
    })
    await tip
      .getByRole('button', { name: 'Sign in to tip', exact: true })
      .click()
    await expect(tip.getByRole('alert')).toContainText(
      'Your words and amount are still here'
    )
    await page.evaluate(() => {
      Reflect.deleteProperty(sessionStorage, 'setItem')
    })
    await tip
      .getByRole('button', { name: 'Sign in to tip', exact: true })
      .click()
    await expect(page).toHaveURL(/\/login\?returnTo=/)
    expect(new URL(page.url()).searchParams.get('returnTo')).toBe(returnPath)
    await page
      .getByLabel('Email', { exact: true })
      .fill(process.env.PLAYWRIGHT_QA_EMAIL!)
    await page
      .getByLabel('Password', { exact: true })
      .fill(process.env.PLAYWRIGHT_QA_PASSWORD!)
    await page.getByRole('button', { name: 'Log in', exact: true }).click()
    await expect(page).toHaveURL(
      new URL(returnPath, process.env.PLAYWRIGHT_BASE_URL!).href
    )
    const resumed = page.getByRole('dialog', {
      name: 'Create highlight',
      exact: true,
    })
    await expect(resumed.getByRole('alert')).toContainText(
      'Your words are still here'
    )
    await expect(tip).toBeHidden()
    await resumed
      .getByRole('button', { name: 'Highlight & tip', exact: true })
      .click()
    await expect(tip).toBeVisible()
    await expect(tip).toContainText('$0.50')
    await page.keyboard.press('Escape')
    await expect(tip).toBeHidden()
    await page.keyboard.press('Escape')
  })

  test('save, appreciate, remove and undo persist without requiring a note or payment', async ({
    page,
  }) => {
    test.setTimeout(90000)
    await page.goto('/login')
    await page
      .getByLabel('Email', { exact: true })
      .fill(process.env.PLAYWRIGHT_QA_EMAIL!)
    await page
      .getByLabel('Password', { exact: true })
      .fill(process.env.PLAYWRIGHT_QA_PASSWORD!)
    await page.getByRole('button', { name: 'Log in', exact: true }).click()
    await expect(page).toHaveURL(/\/$/)
    await page.setViewportSize({ width: 1440, height: 1000 })
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await page.goto(articlePath)
    const rail = page.locator('.reader-passage-rail')
    await expect(rail).toHaveAttribute('open', '')
    const create = await selectPassage(page, 4)
    await expect(
      create.getByRole('button', { name: 'Highlight only', exact: true })
    ).toBeVisible()
    await expect(
      create.getByRole('group', { name: 'Highlight color' })
    ).toHaveCount(0)
    const text = await create.locator('blockquote').innerText()
    await create
      .getByRole('button', { name: 'Highlight & tip', exact: true })
      .click()
    const tip = page.getByTestId('highlight-tip-dialog')
    await expect(tip).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(tip).toBeHidden()
    await expect(create).toBeVisible()
    await page.keyboard.press('Escape')
    const savedPassage = rail.getByRole('button', { name: text, exact: true })
    await expect(savedPassage).toBeVisible()
    const mark = page
      .locator('mark[data-highlight-id]')
      .filter({ hasText: text })
      .first()
    await expect(mark).toBeVisible()
    await savedPassage.press('Enter')
    await expect(mark).toBeFocused()
    await expect(mark).toBeInViewport()
    await mark.click()
    const details = page.getByRole('dialog', {
      name: 'Highlight details',
      exact: true,
    })
    // The disposable account may already have appreciated this passage in a
    // previous QA run. Start the toggle assertion from an observed state.
    await expect(
      details.getByRole('button', { name: 'Remove highlight', exact: true })
    ).toBeVisible()
    const appreciated = details.getByRole('button', {
      name: 'Appreciated',
      exact: true,
    })
    if (await appreciated.isVisible()) await appreciated.click()
    await expect(details.locator('.slip-actions button')).toHaveText([
      'Keep reading',
      'Appreciate for free',
      'Remove highlight',
      'Tip this passage',
    ])
    await details
      .getByRole('button', { name: 'Appreciate for free', exact: true })
      .click()
    await expect(
      details.getByRole('button', { name: 'Appreciated', exact: true })
    ).toHaveAttribute('aria-pressed', 'true')
    await details
      .getByRole('button', { name: 'Keep reading', exact: true })
      .click()
    await page.reload()
    await mark.click()
    await expect(
      details.getByRole('button', { name: 'Appreciated', exact: true })
    ).toHaveAttribute('aria-pressed', 'true')
    await details
      .getByRole('button', { name: 'Appreciated', exact: true })
      .click()
    await expect(
      details.getByRole('button', { name: 'Appreciate for free', exact: true })
    ).toHaveAttribute('aria-pressed', 'false')
    await page.setViewportSize({ width: 390, height: 844 })
    await expect(rail).not.toHaveAttribute('open')
    await expect(savedPassage).toBeHidden()
    await details
      .getByRole('button', { name: 'Remove highlight', exact: true })
      .click()
    await expect(details).toBeHidden()
    await rail.locator('summary').press('Enter')
    await expect(savedPassage).toHaveCount(0)
    await page.getByRole('button', { name: 'Undo', exact: true }).click()
    await expect(
      page.getByText('Highlight restored.', { exact: true })
    ).toBeVisible()
    await expect(savedPassage).toBeVisible()
    await page.reload()
    await expect(rail).not.toHaveAttribute('open')
    await expect(mark).toHaveText(text)
    await mark.click()
    await details
      .getByRole('button', { name: 'Remove highlight', exact: true })
      .click()
  })

  test('failed saves retain the full quote and can be retried', async ({
    page,
  }) => {
    let reject = true
    await page.routeWebSocket(/\.convex\.cloud\//, (socket) => {
      const server = socket.connectToServer()
      socket.onMessage((message) => {
        const data = JSON.parse(message.toString())
        if (
          reject &&
          data.type === 'Mutation' &&
          data.udfPath === 'highlights:createHighlight'
        ) {
          reject = false
          socket.send(
            JSON.stringify({
              type: 'MutationResponse',
              requestId: data.requestId,
              success: false,
              result: 'QA save failure',
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
    const create = await selectPassage(page, 6)
    const quote = await create.locator('blockquote').innerText()
    await create
      .getByRole('button', { name: 'Highlight only', exact: true })
      .click()
    await expect(create.getByRole('alert')).toContainText(
      'Your words are still here'
    )
    await expect(create.locator('blockquote')).toHaveText(quote)
    await create
      .getByRole('button', { name: 'Highlight only', exact: true })
      .click()
    await expect(create).toBeHidden()
  })
})

test('heatmap time ranges and empty states fit the reader at narrow and desktop sizes', async ({
  page,
}) => {
  const now = new Date('2026-10-15T12:00:00Z').getTime()
  const dayMs = 24 * 60 * 60 * 1000
  await page.clock.setFixedTime(now)
  const recentPassage = {
    highlightId: 'fixture-recent',
    text: 'A passage supported within the last thirty days.',
    startOffset: 0,
    endOffset: 51,
    totalAmountCents: 500,
    tipCount: 1,
  }
  const recent = {
    totalTips: 1,
    totalAmountCents: 500,
    totalAmountUsd: 5,
    uniqueTippers: 1,
    topHighlights: [recentPassage],
  }
  const allTime = {
    totalTips: 3,
    totalAmountCents: 1250,
    totalAmountUsd: 12.5,
    uniqueTippers: 2,
    topHighlights: [
      {
        ...recentPassage,
        highlightId: 'fixture-older',
        text: 'An older supported passage.',
        endOffset: 26,
        totalAmountCents: 750,
        tipCount: 2,
      },
      recentPassage,
    ],
  }
  const empty = {
    totalTips: 0,
    totalAmountCents: 0,
    totalAmountUsd: 0,
    uniqueTippers: 0,
    topHighlights: [],
  }
  // Replace only the heatmap's external query, keyed by its subscription ID.
  // Article content, auth and all other queries still use the development backend.
  await page.routeWebSocket(/\.convex\.cloud\//, (socket) => {
    const fixtures = new Map<number, typeof allTime>()
    const server = socket.connectToServer()
    socket.onMessage((message) => {
      const data = JSON.parse(message.toString())
      if (data.type === 'ModifyQuerySet') {
        for (const query of data.modifications) {
          if (query.type === 'Remove') fixtures.delete(query.queryId)
          if (
            query.type === 'Add' &&
            query.udfPath === 'highlightTips:getArticleStats'
          ) {
            const sinceMs = query.args[0].sinceMs
            expect([undefined, now - 7 * dayMs, now - 30 * dayMs]).toContain(
              sinceMs
            )
            fixtures.set(
              query.queryId,
              sinceMs === undefined
                ? allTime
                : sinceMs === now - 7 * dayMs
                  ? empty
                  : recent
            )
          }
        }
      }
      server.send(message)
    })
    server.onMessage((message) => {
      const data = JSON.parse(message.toString())
      for (const modification of data.modifications ?? []) {
        const fixture = fixtures.get(modification.queryId)
        if (modification.type === 'QueryUpdated' && fixture) {
          modification.value = fixture
        }
      }
      socket.send(JSON.stringify(data))
    })
  })
  await page.goto(articlePath)
  await page
    .getByRole('button', { name: 'Article details', exact: true })
    .click()
  const heatmap = page.getByRole('region', {
    name: 'Highlight heatmap',
    exact: true,
  })
  for (const width of [320, 390, 1280]) {
    await page.setViewportSize({ width, height: 700 })
    await expect(
      heatmap.getByRole('button', { name: 'All time' })
    ).toHaveAttribute('aria-pressed', 'true')
    await expect(heatmap.locator('strong')).toHaveText(['3', '$12.50', '2'])
    await expect(heatmap.getByRole('listitem')).toHaveCount(2)
    await expect(heatmap.getByRole('listitem').first()).toContainText(
      'An older supported passage.'
    )
    const baseline = await heatmap.innerText()
    await heatmap.getByRole('button', { name: 'Last 7 days' }).click()
    await expect(
      heatmap.getByRole('button', { name: 'Last 7 days' })
    ).toHaveAttribute('aria-pressed', 'true')
    await expect(
      heatmap.getByText('No highlight tips in the last 7 days', { exact: true })
    ).toBeVisible()
    await expect(heatmap.getByRole('listitem')).toHaveCount(0)
    await heatmap.getByRole('button', { name: 'Last 30 days' }).click()
    await expect(
      heatmap.getByRole('button', { name: 'Last 30 days' })
    ).toHaveAttribute('aria-pressed', 'true')
    await expect(heatmap.locator('strong')).toHaveText(['1', '$5.00', '1'])
    await expect(heatmap.getByRole('listitem')).toHaveCount(1)
    await expect(heatmap.getByRole('listitem')).toContainText(
      recentPassage.text
    )
    await heatmap.getByRole('button', { name: 'All time' }).click()
    await expect(heatmap).toHaveText(baseline, { useInnerText: true })
    await heatmap.scrollIntoViewIfNeeded()
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth)
    ).toBeLessThanOrEqual(width)
  }
})

test('heatmap renders live development data without assuming tip dates', async ({
  page,
}) => {
  await page.goto(articlePath)
  await page
    .getByRole('button', { name: 'Article details', exact: true })
    .click()
  const heatmap = page.getByRole('region', { name: 'Highlight heatmap' })
  for (const [range, label, emptyMessage] of [
    ['All time', 'all time', 'No highlighted passages supported yet'],
    ['Last 7 days', '7 days', 'No highlight tips in the last 7 days'],
    ['Last 30 days', '30 days', 'No highlight tips in the last 30 days'],
  ] as const) {
    await heatmap.getByRole('button', { name: range, exact: true }).click()
    await expect(
      heatmap
        .getByText(`Passage support · ${label}`, { exact: true })
        .or(heatmap.getByText(emptyMessage, { exact: true }))
    ).toBeVisible()
    await expect(heatmap.getByRole('status')).toHaveCount(0)
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
    const creation = await selectPassage(page)
    await creation
      .getByRole('button', { name: 'Highlight only', exact: true })
      .click()
    const dialog = page.getByRole('dialog', {
      name: 'Sign in to save highlights',
      exact: true,
    })
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
