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
// Money text: figures stored at tip time exact to six decimals; the
// reader's converted balance two decimals, marked "≈" by the figure from
// its flag (the fixture writes it as the money layer will).
const NO_EARNINGS_YET = 'No earnings yet. Tips on your writing show up here'
const SCENARIOS: Record<string, Expect> = {
  ready: {
    spend: '≈$2.54',
    earnings: { withdraw: '$0.6825', onWay: '$0.00' },
    rows: 6,
    texts: [
      'Held in Lumens. The dollar figure moves with the price.',
      'New accounts get $5 of testnet practice money.',
      'You can withdraw in a later update. Until then, what has arrived stays here.',
      'These are your share. You keep 97.5% of every tip.',
      'Quilltip runs on Stellar testnet. Tips are practice money.',
    ],
    // No "Pocket" on screen; "≈" only on the converted balance, and no
    // earnings line about prices while their figures are not converted.
    absent: [
      /Pocket/,
      /≈.*≈/,
      /Figures move with the price/,
      /Ready to withdraw/,
    ],
  },
  available: {
    spend: '≈$2.54',
    earnings: { withdraw: '$0.6825', onWay: '$0.00' },
    rows: 6,
  },
  sending: {
    spend: '≈$2.44',
    rows: 1,
    texts: ['Sending', NO_EARNINGS_YET],
  },
  sent: {
    spend: '≈$2.44',
    earnings: {
      withdraw: '$0.00',
      onWay: '$0.0975',
      onWayLabel: 'On its way, 1 tip',
    },
    rows: 2,
    texts: ['in tips on its way to writers', 'On its way'],
  },
  pending: {
    spend: '≈$2.54',
    earnings: {
      withdraw: '$0.0975',
      onWay: '$0.4875',
      onWayLabel: 'On its way, 1 tip',
    },
    rows: 4,
    texts: ['in tips on its way to writers'],
  },
  lagging: {
    earnings: { withdraw: '$0.00', onWay: '$0.0975' },
    rows: 2,
    texts: ['On its way, slower than usual'],
  },
  failed: {
    spend: '≈$2.54',
    rows: 4,
    // Held and incomplete tips are told by their rows, with no notice.
    texts: [
      'Did not complete. You were not charged.',
      'On hold until you add money',
    ],
    absent: [/The reader kept that money/],
  },
  'partly-paid': {
    earnings: { withdraw: '$0.195', onWay: '$0.00' },
    rows: 4,
    texts: ['Paid in part, the rest is waiting', /^Paid in part$/m],
    absent: [/not charged/],
  },
  empty: {
    spend: '≈$2.54',
    rows: 0,
    texts: ['Your tips show up here.', NO_EARNINGS_YET],
  },
  none: { spend: '$0.00', rows: 0, absent: [/≈/, /Held in Lumens/] },
  'no-price': {
    earnings: { withdraw: '$0.6825', onWay: '$0.00' },
    rows: 6,
    texts: ['Dollar value not available right now.'],
    absent: [/≈/, /Held in Lumens/, /New accounts get/],
  },
  offline: {
    spend: '≈$2.54',
    rows: 6,
    texts: ['Offline. These figures are from 6 minutes ago.'],
  },
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

test.describe('who is here', () => {
  test('while auth loads, only a neutral placeholder shows', async ({
    page,
  }) => {
    await page.goto('/pocket?auth=loading')
    const root = page.locator('.qt-pocket')
    await expect(root).toHaveAttribute('data-auth', 'loading')
    await expect(root).toHaveAttribute('aria-busy', 'true')
    await expect(root.locator('[data-skeleton]')).toHaveCount(1)
    const text = await root.innerText()
    for (const words of [
      'Ready to tip',
      'Activity',
      'shows up here',
      'Sign in',
    ])
      expect(text).not.toContain(words)
    expect(await root.textContent()).not.toMatch(/\$\s?\d/)
  })

  test('signed out, the balance asks to sign in and shows no money', async ({
    page,
  }) => {
    await page.goto('/pocket?auth=signed-out')
    const root = page.locator('.qt-pocket')
    await expect(root).toContainText(
      'Sign in to see your balance and your tips.'
    )
    await expect(root.getByRole('link', { name: 'Sign in' })).toHaveAttribute(
      'href',
      '/login'
    )
    await expect(root).not.toContainText('Ready to tip')
    await expect(root).not.toContainText('Activity')
    expect(await root.textContent()).not.toMatch(/\$\s?\d/)
  })
})

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
        await expect(digits(root, 'Arrived')).toHaveText(want.earnings.withdraw)
        await expect(digits(root, 'On its way')).toHaveText(want.earnings.onWay)
        if (want.earnings.onWayLabel)
          await expect(
            root.locator('.qt-money__label', {
              hasText: want.earnings.onWayLabel,
            })
          ).toHaveCount(1)
        await expect(digits(root, 'Paid to your wallet')).toHaveText('$0.00')
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
      // The first release offers no control that does nothing.
      await expect(root.getByRole('button', { name: /Add money/ })).toHaveCount(
        0
      )
      await expect(root.getByRole('button', { name: /^Withdraw/ })).toHaveCount(
        0
      )
      if (want.noFigures) {
        // No dollar figure of any kind while loading or unavailable.
        expect(await root.textContent()).not.toMatch(/\$\s?\d/)
        if (name === 'loading')
          await expect(root.locator('[aria-busy="true"]').first()).toBeVisible()
      }
    })
  }

  test('a tip to you shows your share and the tip it came from', async ({
    page,
  }) => {
    await page.goto('/pocket?scenario=ready&role=writer')
    const rows = page.locator('.qt-pocket__rows > li')
    await expect(rows).toHaveCount(3)
    for (const row of await rows.all())
      await expect(row).toContainText(A_READER)
    await expect(rows.first().locator('.qt-money__digits')).toHaveText(
      '+$0.0975'
    )
    await expect(rows.first()).toContainText('from a $0.10 tip')
    await expect(page.locator('.qt-pocket__rows')).not.toContainText('Wen Hsu')
  })

  test('Your tips and Tips to you are two labelled lists', async ({ page }) => {
    await page.goto('/pocket?scenario=ready')
    const titles = page.locator('.qt-pocket__list-title')
    await expect(titles).toHaveText(['Your tips', 'Tips to you'])
    await expect(page.locator('[data-role="reader"] > li')).toHaveCount(3)
    await expect(page.locator('[data-role="writer"] > li')).toHaveCount(3)
    await expect(
      page.locator('[data-role="reader"] .qt-money__digits').first()
    ).toHaveText('−$0.10')
  })

  test('a writer with nothing yet sees one plain line', async ({ page }) => {
    await page.goto('/pocket?scenario=empty&role=writer')
    const earn = page.locator('.qt-pocket__earn')
    await expect(earn).toContainText(
      'No earnings yet. Tips on your writing show up here, and you keep 97.5% of each.'
    )
    await expect(earn.locator('.qt-money')).toHaveCount(0)
  })

  test('a person who only reads sees no earnings', async ({ page }) => {
    await page.goto('/pocket?scenario=ready&role=reader')
    await expect(
      page.getByRole('heading', { name: 'Your earnings' })
    ).toHaveCount(0)
    await expect(page.locator('.qt-pocket__rows > li')).toHaveCount(3)
  })

  test('writer figures carry "≈" and the section line only when converted', async ({
    page,
  }) => {
    await page.goto('/pocket?scenario=ready&role=writer&writer-converted')
    const root = page.locator('.qt-pocket')
    await expect(digits(root, 'Arrived')).toHaveText('≈$0.68')
    await expect(digits(root, 'Paid to your wallet')).toHaveText('≈$0.00')
    await expect(root).toContainText(
      'Held in Lumens. Figures move with the price; each tip below shows its dollars at the time.'
    )
    // Rows stay exact: the share at the time of the tip.
    await expect(
      root.locator('.qt-pocket__rows .qt-money__digits').first()
    ).toHaveText('+$0.0975')
  })

  test('pending stays apart from available while settlement lags', async ({
    page,
  }) => {
    await page.goto('/pocket?scenario=lagging&role=writer')
    const root = page.locator('.qt-pocket')
    await expect(digits(root, 'On its way')).toHaveText('$0.0975')
    await expect(digits(root, 'Arrived')).toHaveText('$0.00')
  })

  test('the converted figure opens the exact token amount', async ({
    page,
  }) => {
    await page.goto('/pocket?scenario=ready')
    const figure = page.getByRole('button', { name: /Show the exact amount/ })
    await expect(figure).toContainText('Ready to tip')
    await figure.focus()
    await press(figure)
    const sheet = page.getByRole('dialog', { name: 'Exact amount' })
    await expect(sheet).toBeVisible()
    await expect(sheet.locator('.qt-pocket__token-figure')).toHaveText(
      /^[\d,]+\.\d+ XLM$/
    )
    await expect(sheet).toContainText('Your balance is held in Lumens.')
    await expect(sheet).toContainText('At today’s price of $0.1273')
    await expect(sheet).toContainText('Tips are sent in dollars.')
    await page.keyboard.press('Escape')
    await expect
      .poll(() =>
        page.evaluate(() =>
          document.activeElement?.classList.contains('qt-pocket__figure-button')
        )
      )
      .toBe(true)
  })

  test('with no price, the balance is the token amount and no dollar value', async ({
    page,
  }) => {
    await page.goto('/pocket?scenario=no-price')
    const spend = page.locator('.qt-pocket__spend')
    await expect(spend.locator('.qt-pocket__token-figure')).toHaveText(
      /^[\d,]+(\.\d+)? XLM$/
    )
    await expect(spend.locator('.qt-money__label')).toHaveText('Ready to tip')
    await expect(spend).toContainText('Dollar value not available right now.')
    // Never a dollar figure for it, zero or converted, and nothing to open.
    expect(await spend.textContent()).not.toMatch(/\$|≈/)
    await expect(
      page.getByRole('button', { name: /Show the exact amount/ })
    ).toHaveCount(0)
    await expect(spend.locator('[data-skeleton]')).toHaveCount(0)
  })

  test('an exact balance is not a button and says nothing about prices', async ({
    page,
  }) => {
    await page.goto('/pocket?scenario=none')
    await expect(
      page.getByRole('button', { name: /Show the exact amount/ })
    ).toHaveCount(0)
    await expect(page.locator('.qt-pocket')).not.toContainText('Held in Lumens')
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

/** Opens Add money the way the tip bar does: a tip the balance cannot cover. */
async function openAddMoney(page: Page) {
  const tip = page.locator('[data-fixture="needs-funds"]')
  await tip.focus()
  await press(tip)
  const sheet = page.getByRole('dialog', { name: 'Add money to tip $1.00' })
  await expect(sheet).toBeVisible()
  await settled(page)
  return sheet
}

test.describe('receipts and money sheets', () => {
  test('a row opens its receipt as a sheet; the split is stated once', async ({
    page,
  }) => {
    await page.goto('/?scenario=ready')
    await openFromBar(page)
    const link = pocket(page).getByRole('button', { name: 'Wen Hsu' }).first()
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
      receipt.getByText('$0.0975, after Quilltip’s $0.0025')
    ).toHaveCount(1)
    await expect(receipt.getByRole('link', { name: /^View/ })).toHaveAttribute(
      'href',
      /stellar\.expert\/explorer\/testnet\/tx\//
    )
    await page.keyboard.press('Escape')
    await expect(receipt).toBeHidden()
    await expect(pocket(page)).toBeVisible()
    await expect.poll(async () => (await focused(page)).text).toBe('Wen Hsu')
  })

  test('a partly paid tip says what arrived and what waits', async ({
    page,
  }) => {
    await page.goto('/pocket?scenario=partly-paid&role=reader')
    await press(page.getByRole('button', { name: 'Wen Hsu' }).first())
    const receipt = page.getByRole('dialog', { name: 'Receipt' })
    await expect(receipt).toContainText(
      '$0.10 reached the writer; $0.15 is waiting'
    )
    await expect(receipt).not.toContainText('not charged')
  })

  test('Add money from a tip says what will be possible and offers no fake action', async ({
    page,
  }) => {
    await page.goto('/article?scenario=ready')
    const sheet = await openAddMoney(page)
    expect(new URL(page.url()).pathname).toBe('/article')
    await expect
      .poll(async () => (await focused(page)).text)
      .toBe('Add money to tip $1.00')
    await expect(sheet).toContainText(
      'Nothing is sent until you tap Tip again.'
    )
    await expect(
      sheet.getByRole('button', { name: /practice money/ })
    ).toHaveCount(0)
    await expect(sheet).toContainText('You cannot add money here yet.')
    await expect(
      sheet.getByRole('link', {
        name: 'add testnet money on the current balance page',
      })
    ).toHaveAttribute('href', '/dashboard/tab')
    await page.keyboard.press('Escape')
    await expect
      .poll(
        async () =>
          await page.evaluate(() =>
            document.activeElement?.getAttribute('data-fixture')
          )
      )
      .toBe('needs-funds')
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

  test('Withdraw appears with its act and moves the exact figure', async ({
    page,
  }) => {
    await page.goto('/pocket?scenario=ready&role=writer&act=withdraw')
    await press(page.getByRole('button', { name: 'Withdraw $0.6825' }))
    const sheet = page.getByRole('dialog', { name: 'Withdraw' })
    await expect(sheet.locator('.qt-money__digits')).toHaveText('$0.6825')
    await expect(sheet).toContainText('Tips on their way are not included.')
    await press(sheet.getByRole('button', { name: 'Withdraw $0.6825' }))
    await expect
      .poll(async () => (await focused(page)).text)
      .toBe('$0.6825 sent to your wallet')
  })
})

test.describe('review cases', () => {
  test('Show more stays while the next page loads, then says the list ended', async ({
    page,
  }) => {
    await page.goto('/pocket?scenario=ready&paged')
    const list = page.locator('section.qt-pocket__list', {
      has: page.getByRole('heading', { name: 'Your tips' }),
    })
    await expect(list.locator('li')).toHaveCount(2)
    const more = list.getByRole('button', { name: 'Show more' })
    await more.focus()
    await page.keyboard.press('Enter')
    // Still there, busy, while the page loads; focus stays on it.
    await expect(more).toHaveAttribute('aria-busy', 'true')
    await expect(more).toBeFocused()
    await expect(list.locator('li')).toHaveCount(3)
    await expect(more).toHaveCount(0)
    const end = list.getByText('That is all of them.')
    await expect(end).toBeVisible()
    await expect(end).toBeFocused()
  })

  test('a sending tip’s receipt states no share or fee yet', async ({
    page,
  }) => {
    await page.goto('/pocket?scenario=sending')
    await press(page.getByRole('button', { name: 'Wen Hsu' }))
    const receipt = page.getByRole('dialog', { name: 'Receipt' })
    await expect(receipt).toContainText('Sending')
    await expect(receipt).not.toContainText('share')
    await expect(receipt).not.toContainText('Quilltip’s')
  })

  test('each row is named by the person, the amount and what it opens', async ({
    page,
  }) => {
    await page.goto('/pocket?scenario=ready')
    await expect(
      page.getByRole('button', {
        name: 'A reader, plus 9.75 cents, open receipt',
        exact: true,
      })
    ).toHaveCount(2)
    await expect(
      page.getByRole('button', {
        name: 'Wen Hsu, minus 10 cents, open receipt',
        exact: true,
      })
    ).toHaveCount(2)
    await expect(
      page.getByRole('button', {
        name: 'Wen Hsu, minus 50 cents, open receipt',
        exact: true,
      })
    ).toHaveCount(1)
  })

  test('a writer’s receipt shows the share and its own token amount', async ({
    page,
  }) => {
    await page.goto('/pocket?scenario=ready&role=writer')
    await press(page.getByRole('button', { name: 'A reader' }).first())
    const receipt = page.getByRole('dialog', { name: 'Receipt' })
    await expect(receipt.locator('.qt-money__digits').first()).toHaveText(
      '$0.0975'
    )
    await expect(receipt).toContainText('$0.0975, after Quilltip’s $0.0025')
    await expect(receipt).toContainText('0.7657388 XLM')
    await expect(receipt).not.toContainText('0.7853732 XLM')
  })

  test('a tip paid in part shows what was paid on both sides', async ({
    page,
  }) => {
    await page.goto('/pocket?scenario=partly-paid')
    await expect(
      page.locator('[data-role="reader"] .qt-money__digits').first()
    ).toHaveText('−$0.10')
    await expect(
      page.locator('[data-role="writer"] .qt-money__digits').first()
    ).toHaveText('+$0.0975')
  })

  test('while earnings load, space is held with no heading or figure', async ({
    page,
  }) => {
    await page.goto('/pocket?scenario=ready&earnings=loading')
    await expect(page.locator('.qt-pocket__earn-placeholder')).toBeVisible()
    await expect(
      page.getByRole('heading', { name: 'Your earnings' })
    ).toHaveCount(0)
  })

  test('a known writer keeps the earnings section through an outage', async ({
    page,
  }) => {
    await page.goto('/pocket?scenario=ready&earnings-later=unavailable')
    const earn = page.locator('.qt-pocket__earn')
    await expect(
      earn.getByRole('heading', { name: 'Your earnings' })
    ).toBeVisible()
    await expect(earn).toContainText(
      'Your earnings cannot be shown right now. Nothing you earned is lost.'
    )
    await expect(
      earn.getByRole('heading', { name: 'Your earnings' })
    ).toBeVisible()
    expect(await earn.textContent()).not.toMatch(/\$\s?\d/)
  })

  test('awkward values lay out as the money layer writes them', async ({
    page,
  }) => {
    await page.goto('/pocket?scenario=awkward')
    const root = page.locator('.qt-pocket')
    await expect(digits(root, 'Ready to tip')).toHaveText('≈$1,234.56')
    const tipToYou = page.locator('[data-role="writer"] li').first()
    await expect(tipToYou.locator('.qt-money__digits')).toHaveText('+$0.04875')
    await expect(tipToYou).toContainText('from a $0.05 tip')
    expect(await root.textContent()).not.toContain('<$0.01')
  })

  test('a dust balance reads $0.00 with the exact amount one tap away', async ({
    page,
  }) => {
    await page.goto('/pocket?scenario=dust')
    const root = page.locator('.qt-pocket')
    await expect(digits(root, 'Ready to tip')).toHaveText('≈$0.00')
    expect(await root.textContent()).not.toContain('<$0.01')
    await press(page.getByRole('button', { name: /Show the exact amount/ }))
    await expect(
      page
        .getByRole('dialog', { name: 'Exact amount' })
        .locator('.qt-pocket__token-figure')
    ).toHaveText('0.0000003 XLM')
  })

  test('before the money layer is connected, it says so and links to what works', async ({
    page,
  }) => {
    await page.goto('/pocket?unwired')
    const root = page.locator('.qt-pocket')
    // The shell's own reading of what can be tipped, and no tips or
    // earnings of its own.
    await expect(digits(root, 'Ready to tip')).toHaveText('≈$2.54')
    await expect(root).toContainText('Your tips and earnings are not here yet')
    await expect(root.locator('.qt-pocket__rows')).toHaveCount(0)
    await expect(
      root.getByRole('heading', { name: 'Your earnings' })
    ).toHaveCount(0)
    await expect(
      root.getByRole('link', { name: 'your balance' })
    ).toHaveAttribute('href', '/dashboard/tab')
    await expect(
      root.getByRole('link', { name: 'your earnings' })
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
      await press(page.getByRole('button', { name: 'Wen Hsu' }).first())
      await expect(page.getByRole('dialog', { name: 'Receipt' })).toBeVisible()
      await settled(page)
      expect(await auditTextContrast(page), 'receipt').toEqual([])
      await page.goto('/article?scenario=ready')
      await openAddMoney(page)
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
