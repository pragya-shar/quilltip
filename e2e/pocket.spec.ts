import { expect, test, type Locator, type Page } from '@playwright/test'
import {
  auditControlContrast,
  auditHitAreas,
  auditTextContrast,
  horizontalOverflow,
} from './helpers/systemAudit'

// The balance (the Pocket) on the application shell, on fixture money
// (e2e/fixtures/pocket): it opens over a place or an article and gives
// them back, every money scenario says what it should, and money sheets
// follow the focus rules. Run: bun run test:e2e:fixtures --suite pocket

test.skip(
  !process.env.POCKET_FIXTURES,
  'Needs the Pocket fixture server (bun run test:e2e:fixtures --suite pocket)'
)

const wide = () => (test.info().project.use.viewport?.width ?? 0) >= 1024
const hasTouch = () => Boolean(test.info().project.use.hasTouch)
const tabKey = (browserName: string) =>
  browserName === 'webkit' ? 'Alt+Tab' : 'Tab'

async function press(target: Locator) {
  if (hasTouch()) await target.tap()
  else await target.click()
}

/** The open Pocket: a sheet on a phone, the right panel on a desktop. */
const pocket = (page: Page) =>
  wide()
    ? page.getByRole('complementary', { name: 'Balance' })
    : page.getByRole('dialog', { name: 'Balance' })

const balanceItem = (page: Page) => page.locator('[data-balance]:visible')

/** What the person sees in a figure: "≈$2.54". */
const digits = (root: Locator, label: string) =>
  root
    .locator('.qt-money', {
      has: root.page().locator('.qt-money__label', { hasText: label }),
    })
    .locator('.qt-money__digits')
    .first()

const focused = (page: Page) =>
  page.evaluate(() => {
    const el = document.activeElement as HTMLElement | null
    return {
      text: el?.textContent?.trim() ?? '',
      label: el?.getAttribute('aria-label') ?? null,
      balance: el?.hasAttribute('data-balance') ?? false,
      caption: el?.getAttribute('data-fixture') === 'balance-caption',
    }
  })

/** Until every finite animation (a sheet or panel arriving) has ended, so
 * colours are measured as they rest. */
const settled = (page: Page) =>
  page.waitForFunction(() =>
    document
      .getAnimations()
      .every(
        (a) =>
          a.playState !== 'running' ||
          a.effect?.getComputedTiming().iterations === Infinity
      )
  )

async function openFromBar(page: Page) {
  await press(balanceItem(page))
  await expect(pocket(page)).toBeVisible()
  await settled(page)
}

test.describe('over what the person is doing', () => {
  test('opens over Today and gives back its place and focus', async ({
    page,
  }) => {
    await page.goto('/?scenario=ready')
    await page.evaluate(() => window.scrollTo(0, 900))
    const before = await page.evaluate(() => window.scrollY)
    expect(before).toBeGreaterThan(0)
    await balanceItem(page).focus()
    await openFromBar(page)
    expect(new URL(page.url()).pathname).toBe('/')
    await expect.poll(async () => (await focused(page)).text).toBe('Balance')
    await page.keyboard.press('Escape')
    await expect(pocket(page)).toBeHidden()
    expect(new URL(page.url()).pathname).toBe('/')
    expect(
      Math.abs((await page.evaluate(() => window.scrollY)) - before)
    ).toBeLessThan(2)
    await expect.poll(async () => (await focused(page)).balance).toBe(true)
  })

  test('opens over an article and gives it back', async ({ page }) => {
    await page.goto('/article?scenario=ready')
    await page.evaluate(() => window.scrollTo(0, 600))
    const before = await page.evaluate(() => window.scrollY)
    const opener = wide()
      ? balanceItem(page)
      : page.locator('[data-fixture="balance-caption"]')
    await opener.focus()
    await press(opener)
    await expect(pocket(page)).toBeVisible()
    await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1)
    expect(new URL(page.url()).pathname).toBe('/article')
    await press(pocket(page).getByRole('button', { name: /^Close/ }))
    await expect(pocket(page)).toBeHidden()
    expect(new URL(page.url()).pathname).toBe('/article')
    expect(
      Math.abs((await page.evaluate(() => window.scrollY)) - before)
    ).toBeLessThan(2)
    await expect
      .poll(async () => {
        const f = await focused(page)
        return wide() ? f.balance : f.caption
      })
      .toBe(true)
  })

  test('on a desktop it is a panel beside the page, not over it', async ({
    page,
  }) => {
    test.skip(!wide(), 'desktop only')
    await page.goto('/?scenario=ready')
    await openFromBar(page)
    await expect(page.getByRole('dialog')).toHaveCount(0)
    const panel = await pocket(page).boundingBox()
    const main = await page.locator('#content').boundingBox()
    expect(panel!.x).toBeGreaterThanOrEqual(main!.x + main!.width - 1)
    // The page stays usable beside it.
    await expect(page.locator('#p-1')).toBeVisible()
    await expect(digits(pocket(page), 'Ready to tip')).toHaveText('≈$2.54')
  })

  test('/pocket is a page with the same content', async ({ page }) => {
    await page.goto('/pocket?scenario=ready')
    await expect(
      page.getByRole('heading', { level: 1, name: 'Balance' })
    ).toBeVisible()
    await expect(digits(page.locator('.qt-pocket'), 'Ready to tip')).toHaveText(
      '≈$2.54'
    )
    await expect(page.locator('noscript')).toHaveCount(1)
  })
})

type Expect = {
  spend?: string
  earnings?: { withdraw: string; onWay: string; onWayLabel?: string } | null
  rows?: number
  texts?: (string | RegExp)[]
  absent?: (string | RegExp)[]
  noFigures?: boolean
}

const A_READER = 'A reader'
const SCENARIOS: Record<string, Expect> = {
  ready: {
    spend: '≈$2.54',
    earnings: { withdraw: '$0.68', onWay: '$0.00' },
    rows: 6,
    texts: ['An estimate at today’s price.', 'Testnet. Practice money only.'],
  },
  available: {
    spend: '≈$2.54',
    earnings: { withdraw: '$0.68', onWay: '$0.00' },
    rows: 6,
  },
  sending: { spend: '≈$2.44', earnings: null, rows: 1, texts: ['Sending'] },
  sent: {
    spend: '≈$2.44',
    earnings: {
      withdraw: '$0.00',
      onWay: '$0.09',
      onWayLabel: 'On its way, 1 tip',
    },
    rows: 2,
    texts: [
      'in tips on its way to writers',
      'On its way',
      'Nothing to withdraw yet. Tips on their way',
    ],
  },
  pending: {
    spend: '≈$2.54',
    earnings: {
      withdraw: '$0.09',
      onWay: '$0.48',
      onWayLabel: 'On its way, 1 tip',
    },
    rows: 4,
    texts: ['in tips on its way to writers'],
  },
  lagging: {
    earnings: { withdraw: '$0.00', onWay: '$0.09' },
    rows: 2,
    texts: [
      'On its way, slower than usual',
      'Some tips are taking longer than usual',
    ],
  },
  failed: {
    spend: '≈$2.54',
    earnings: { withdraw: '$0.00', onWay: '$0.00' },
    rows: 4,
    texts: [
      'Did not complete. You were not charged.',
      'On hold until you add money',
      /is on hold \(1 tip\)/,
      /did not complete \(1 tip\)\. The reader kept that money\./,
    ],
  },
  'partly-paid': {
    earnings: { withdraw: '$0.19', onWay: '$0.00' },
    rows: 4,
    texts: ['Paid in part, the rest is waiting', /^Paid in part$/m],
    absent: [/not charged/],
  },
  empty: {
    spend: '≈$2.54',
    earnings: null,
    rows: 0,
    texts: ['Your tips show up here.'],
  },
  none: { spend: '$0.00', earnings: null, rows: 0 },
  offline: { spend: '≈$2.54', rows: 6, texts: ['You are offline'] },
  loading: { noFigures: true, earnings: null },
  unavailable: {
    noFigures: true,
    earnings: null,
    texts: [
      'Not available right now',
      'Payments are not answering right now',
      'Your activity cannot be shown right now.',
    ],
  },
}

test.describe('every money scenario', () => {
  for (const [name, want] of Object.entries(SCENARIOS)) {
    test(`${name}`, async ({ page }) => {
      await page.goto(`/pocket?scenario=${name}`)
      const root = page.locator('.qt-pocket')
      await expect(root).toBeVisible()
      if (want.spend)
        await expect(digits(root, 'Ready to tip')).toHaveText(want.spend)
      if (want.earnings === null)
        await expect(
          root.getByRole('heading', { name: 'Your earnings' })
        ).toHaveCount(0)
      else if (want.earnings) {
        await expect(digits(root, 'Ready to withdraw')).toHaveText(
          want.earnings.withdraw
        )
        await expect(digits(root, 'On its way')).toHaveText(want.earnings.onWay)
        if (want.earnings.onWayLabel)
          await expect(
            root.locator('.qt-money__label', {
              hasText: want.earnings.onWayLabel,
            })
          ).toHaveCount(1)
        await expect(
          root.locator('.qt-pocket__collected .qt-money__digits')
        ).toHaveText('$0.00')
      }
      if (want.rows !== undefined)
        await expect(root.locator('.qt-pocket__rows > li')).toHaveCount(
          want.rows
        )
      const text = (await root.innerText()).replace(/\s+/g, ' ')
      for (const t of want.texts ?? [])
        if (typeof t === 'string') expect(text).toContain(t)
        else expect(await root.innerText()).toMatch(t)
      for (const t of want.absent ?? []) expect(text).not.toMatch(t)
      if (want.noFigures) {
        // No dollar figure of any kind while loading or unavailable.
        expect(await root.textContent()).not.toMatch(/\$\s?\d/)
        if (name === 'loading')
          await expect(root.locator('[aria-busy="true"]').first()).toBeVisible()
      }
    })
  }

  test('a received tip names no one', async ({ page }) => {
    await page.goto('/pocket?scenario=ready&role=writer')
    const rows = page.locator('.qt-pocket__rows > li')
    await expect(rows).toHaveCount(3)
    for (const row of await rows.all())
      await expect(row).toContainText(A_READER)
    await expect(page.locator('.qt-pocket__rows')).not.toContainText(
      'Theo Marsh'
    )
  })

  test('a person who only reads sees no earnings', async ({ page }) => {
    await page.goto('/pocket?scenario=ready&role=reader')
    await expect(
      page.getByRole('heading', { name: 'Your earnings' })
    ).toHaveCount(0)
    await expect(page.locator('.qt-pocket__rows > li')).toHaveCount(3)
  })

  test('pending stays apart from available while settlement lags', async ({
    page,
  }) => {
    await page.goto('/pocket?scenario=lagging&role=writer')
    const root = page.locator('.qt-pocket')
    await expect(digits(root, 'On its way')).toHaveText('$0.09')
    await expect(digits(root, 'Ready to withdraw')).toHaveText('$0.00')
    await expect(root.getByRole('button', { name: 'Withdraw' })).toHaveCount(0)
  })

  test('the exact token amount is one tap away', async ({ page }) => {
    await page.goto('/pocket?scenario=ready')
    const reveal = page.getByRole('button', { name: 'Show exact amount' })
    await expect(page.getByText(/XLM on Stellar testnet/)).toBeHidden()
    await press(reveal)
    await expect(
      page.getByRole('button', { name: 'Hide exact amount' })
    ).toHaveAttribute('aria-expanded', 'true')
    await expect(page.getByText(/XLM on Stellar testnet/)).toBeVisible()
  })

  test('a tip sent elsewhere shows once, and once after a reload', async ({
    page,
    context,
  }) => {
    await page.goto('/pocket?scenario=ready')
    const elsewhere = await context.newPage()
    await elsewhere.goto('/elsewhere')
    await elsewhere.getByRole('button', { name: /Send a 25¢ tip/ }).click()
    const row = page.locator('[data-request="request-elsewhere"]')
    await expect(row).toHaveCount(1)
    await page.reload()
    await expect(row).toHaveCount(1)
    await expect(page.locator('.qt-pocket__rows > li')).toHaveCount(7)
    await page.goto('/?scenario=ready')
    await openFromBar(page)
    await expect(
      pocket(page).locator('[data-request="request-elsewhere"]')
    ).toHaveCount(1)
  })
})

test.describe('receipts and money sheets', () => {
  test('a row opens its receipt as a sheet; the split is stated once', async ({
    page,
  }) => {
    await page.goto('/?scenario=ready')
    await openFromBar(page)
    const link = pocket(page).getByRole('link', { name: 'Theo Marsh' }).first()
    await link.focus()
    await press(link)
    const receipt = page.getByRole('dialog', { name: 'Receipt' })
    await expect(receipt).toBeVisible()
    expect(new URL(page.url()).pathname).toBe('/')
    await expect.poll(async () => (await focused(page)).text).toBe('Receipt')
    await expect(receipt.locator('.qt-money__digits').first()).toHaveText(
      '$0.10'
    )
    await expect(
      receipt.getByText('The writer gets 9.75¢. Quilltip keeps 0.25¢.')
    ).toHaveCount(1)
    await expect(
      receipt.getByRole('link', { name: /View on Stellar testnet/ })
    ).toHaveAttribute('href', /stellar\.expert\/explorer\/testnet\/tx\//)
    await page.keyboard.press('Escape')
    await expect(receipt).toBeHidden()
    await expect(pocket(page)).toBeVisible()
    await expect.poll(async () => (await focused(page)).text).toBe('Theo Marsh')
  })

  test('a partly paid tip says what arrived and what waits', async ({
    page,
  }) => {
    await page.goto('/pocket?scenario=partly-paid&role=reader')
    await press(page.getByRole('link', { name: 'Theo Marsh' }).first())
    const receipt = page.getByRole('dialog', { name: 'Receipt' })
    await expect(receipt).toContainText(
      '10¢ reached the writer; 15¢ is waiting.'
    )
    await expect(receipt).not.toContainText('not charged')
  })

  test('Add money says what will be possible and offers no fake action', async ({
    page,
  }) => {
    await page.goto('/?scenario=ready')
    await openFromBar(page)
    const add = pocket(page).getByRole('button', { name: 'Add money' })
    await add.focus()
    await press(add)
    const sheet = page.getByRole('dialog', { name: 'Add money' })
    await expect(sheet).toBeVisible()
    await expect.poll(async () => (await focused(page)).text).toBe('Add money')
    await expect(
      sheet.getByRole('button', { name: /practice money/ })
    ).toHaveCount(0)
    await expect(sheet).toContainText('Soon you can add $5 of practice money')
    await expect(
      sheet.getByRole('link', { name: 'add money on the current balance page' })
    ).toHaveAttribute('href', '/dashboard/tab')
    await expect(sheet.getByText('Testnet. Practice money only.')).toHaveCount(
      1
    )
    await page.keyboard.press('Escape')
    await expect.poll(async () => (await focused(page)).text).toBe('Add money')
  })

  test('a money act moves focus to its status, then its result', async ({
    page,
  }) => {
    await page.goto('/?scenario=ready&act=add')
    await openFromBar(page)
    const add = pocket(page).getByRole('button', { name: 'Add money' })
    await add.focus()
    await press(add)
    const sheet = page.getByRole('dialog', { name: 'Add money' })
    await press(sheet.getByRole('button', { name: 'Add $5 practice money' }))
    await expect.poll(async () => (await focused(page)).text).toBe('Adding $5')
    await expect
      .poll(async () => (await focused(page)).text)
      .toBe('$5 added to your balance')
    await press(sheet.getByRole('button', { name: 'Done' }))
    await expect(sheet).toBeHidden()
    await expect.poll(async () => (await focused(page)).text).toBe('Add money')
  })

  test('a failed money act says so and can be tried again', async ({
    page,
  }) => {
    await page.goto('/pocket?scenario=ready&act=add-fail')
    await press(page.getByRole('button', { name: 'Add money' }))
    const sheet = page.getByRole('dialog', { name: 'Add money' })
    await press(sheet.getByRole('button', { name: 'Add $5 practice money' }))
    await expect
      .poll(async () => (await focused(page)).text)
      .toBe('That did not go through. Nothing was added.')
    await press(sheet.getByRole('button', { name: 'Try again' }))
    await expect(
      sheet.getByRole('button', { name: 'Add $5 practice money' })
    ).toBeVisible()
  })

  test('Withdraw shows only what is ready, with no fake action', async ({
    page,
  }) => {
    await page.goto('/pocket?scenario=ready&role=writer')
    await press(page.getByRole('button', { name: 'Withdraw' }))
    const sheet = page.getByRole('dialog', { name: 'Withdraw' })
    await expect(sheet.locator('.qt-money__digits')).toHaveText('$0.68')
    await expect(sheet).toContainText('Tips on their way are not included.')
    await expect(sheet.getByRole('button', { name: 'Withdraw' })).toHaveCount(0)
    await expect(
      sheet.getByRole('link', {
        name: 'collect it on the current earnings page',
      })
    ).toHaveAttribute('href', '/dashboard/stats')
  })
})

test.describe('focus, contrast and fit', () => {
  test('the sheet opens on its title; Tab wraps both ways', async ({
    page,
    browserName,
  }) => {
    test.skip(wide(), 'the phone sheet is modal; the desktop panel is not')
    await page.goto('/?scenario=ready')
    await openFromBar(page)
    await expect.poll(async () => (await focused(page)).text).toBe('Balance')
    const sheet = pocket(page)
    const count = await sheet.evaluate(
      (el) =>
        [
          ...el.querySelectorAll<HTMLElement>('a[href], button:not(:disabled)'),
        ].filter((c) => c.getClientRects().length > 0).length
    )
    const shift = browserName === 'webkit' ? 'Shift+Alt+Tab' : 'Shift+Tab'
    await page.keyboard.press(shift)
    await expect.poll(async () => (await focused(page)).label).toBe('Close')
    await page.keyboard.press(tabKey(browserName))
    const first = await focused(page)
    for (let i = 0; i < count; i += 1) {
      await page.keyboard.press(tabKey(browserName))
      expect(
        await sheet.evaluate((el) => el.contains(document.activeElement))
      ).toBe(true)
    }
    expect(await focused(page)).toEqual(first)
    await page.keyboard.press('Escape')
    await expect.poll(async () => (await focused(page)).balance).toBe(true)
  })

  for (const scheme of ['light', 'dark'] as const) {
    test(`every text and control pair meets contrast (${scheme})`, async ({
      page,
    }) => {
      await page.emulateMedia({ colorScheme: scheme })
      for (const name of ['ready', 'failed', 'partly-paid', 'unavailable']) {
        await page.goto(`/?scenario=${name}`)
        await openFromBar(page)
        expect(await auditTextContrast(page), name).toEqual([])
        expect(await auditControlContrast(page), name).toEqual([])
      }
      await page.goto('/pocket?scenario=ready')
      await press(page.getByRole('link', { name: 'Theo Marsh' }).first())
      await expect(page.getByRole('dialog', { name: 'Receipt' })).toBeVisible()
      await settled(page)
      expect(await auditTextContrast(page), 'receipt').toEqual([])
      await page.keyboard.press('Escape')
      await press(page.getByRole('button', { name: 'Add money' }))
      await expect(
        page.getByRole('dialog', { name: 'Add money' })
      ).toBeVisible()
      await settled(page)
      expect(await auditTextContrast(page), 'add money').toEqual([])
      expect(await auditControlContrast(page), 'add money').toEqual([])
    })
  }

  test('every control offers at least 44 by 44 px', async ({ page }) => {
    await page.goto('/?scenario=ready')
    await openFromBar(page)
    expect(await auditHitAreas(page)).toEqual([])
  })

  test('no horizontal scroll at 360, 375 and 390', async ({ page }) => {
    test.skip(wide(), 'phone widths')
    for (const width of [360, 375, 390]) {
      await page.setViewportSize({ width, height: 800 })
      for (const path of [
        '/pocket?scenario=ready',
        '/pocket?scenario=failed',
      ]) {
        await page.goto(path)
        const page1 = await horizontalOverflow(page)
        expect(
          page1.scrollWidth,
          `${path} at ${width}: ${page1.offenders}`
        ).toBeLessThanOrEqual(page1.width)
      }
      await page.goto('/?scenario=partly-paid')
      await openFromBar(page)
      const sheet = await pocket(page).evaluate((el) => ({
        scroll: el.querySelector('.qt-modal__body')?.scrollWidth ?? 0,
        width: el.querySelector('.qt-modal__body')?.clientWidth ?? 0,
      }))
      expect(sheet.scroll, `sheet at ${width}`).toBeLessThanOrEqual(sheet.width)
    }
  })
})
