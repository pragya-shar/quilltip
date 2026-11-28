import { expect, test, type Locator, type Page } from '@playwright/test'
import { horizontalOverflow } from './helpers/systemAudit'

// Add money, quick tips and turn off, on an emulated wallet and network
// (e2e/fixtures/add-money): the five cases and their defaults, cancelling
// in the wallet, a closed or blocked wallet window, a lost network, and
// turning quick tips off. A top-up and an approval never send a tip.
// Run: bun run test:e2e:fixtures --suite add-money

test.skip(
  !process.env.ADD_MONEY_FIXTURES,
  'Needs the Add money fixture server (bun run test:e2e:fixtures --suite add-money)'
)

const hasTouch = () => Boolean(test.info().project.use.hasTouch)

async function press(target: Locator) {
  await expect(target).toBeVisible()
  // The sheet holds presses for a moment after its content changes.
  await target.page().waitForTimeout(450)
  if (hasTouch()) await target.tap()
  else await target.click()
}

const sheet = (page: Page) => page.getByRole('dialog').last()
const tipButton = (page: Page) => page.locator('[data-fixture="tip"]')
const log = (page: Page) =>
  page.evaluate(() => window.__wallet.log) as Promise<{
    signed: string[]
    sent: string[]
    tips: number
    stopped: number[]
  }>
const answer = (page: Page, next: string) =>
  page.evaluate((n) => {
    ;(window.__wallet as { next: string }).next = n
  }, next)

async function open(page: Page, query: string, path = '/') {
  await page.goto(`${path}?${query}`)
}

async function toReview(page: Page) {
  await press(tipButton(page))
  await expect(sheet(page)).toContainText('Add money to tip $1')
  await press(sheet(page).getByRole('button', { name: 'Review $10' }))
}

async function connectAlbedo(page: Page) {
  await press(sheet(page).getByRole('button', { name: /Albedo/ }))
}

test.describe('from a tip, a first deposit (A)', () => {
  test('adds money and sets up quick tips in one approval, then back to the line, with no tip sent', async ({
    page,
  }) => {
    await open(page, 'balance=0')
    await expect(tipButton(page)).toHaveText('Add money to tip $1')
    await toReview(page)
    const s = sheet(page)
    await expect(s).toContainText('Add $10.00 to your balance.')
    await expect(s).toContainText(
      /Tip from your balance on this device until \w{3} \d{1,2} \w{3}, \d{2}:\d{2}, up to [\d.]+ XLM \(≈ \$[\d.]+\), without asking your wallet each time\./
    )
    await expect(s).toContainText(
      'Quick tips: tip from your balance on this device without opening your wallet each time.'
    )
    await expect(s).toContainText(
      '0.0953987 XLM (≈ $0.01), paid by your wallet'
    )
    await expect(s).not.toContainText(/7 days|a week/)
    await expect(s).toContainText(
      'You can turn quick tips off in Balance, from any device you sign in on. Signing out turns them off on this device.'
    )
    await expect(
      s.getByRole('button', { name: 'Add $10 and set up quick tips' })
    ).toBeVisible()
    await expect(
      s.getByRole('button', { name: 'Add money only' })
    ).toBeVisible()
    // No disabled choice anywhere in the review.
    await expect(
      s.locator('button[disabled], [aria-disabled="true"]')
    ).toHaveCount(0)
    expect(await horizontalOverflow(page)).toMatchObject({ offenders: [] })

    // No wallet connected yet: the picker, then the review again, named.
    await press(
      s.getByRole('button', { name: 'Add $10 and set up quick tips' })
    )
    await expect(s).toContainText('Add from a Stellar testnet wallet')
    await expect(s).toContainText('Opens albedo.link in a new window')
    await connectAlbedo(page)
    await expect(s).toContainText('Albedo · GABC…WXYZ')
    expect((await log(page)).signed).toEqual([])

    await press(
      s.getByRole('button', { name: 'Add $10 and set up quick tips' })
    )
    await expect(s).toContainText(/Added \$10\.00\./)
    await expect(s).toContainText(/Quick tips are on for this device until/)
    await press(s.getByRole('button', { name: 'Back to your tip' }))
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await expect(tipButton(page)).toHaveText('Tip this line $1')
    await expect(page.locator('[data-chosen]')).toHaveCount(1)
    const after = await log(page)
    expect(after.signed).toEqual(['open_session'])
    expect(after.tips).toBe(0)
  })

  test('"Add money only" makes the request money only, and the device still needs setup after', async ({
    page,
  }) => {
    await open(page, 'balance=0&connected')
    await toReview(page)
    const s = sheet(page)
    await press(s.getByRole('button', { name: 'Add money only' }))
    await expect(s).toContainText(
      'Only money is added. This device will ask your wallet before it tips.'
    )
    await expect(
      s.getByRole('button', { name: 'Add $10', exact: true })
    ).toBeVisible()
    await expect(
      s.getByRole('button', { name: 'Also set up quick tips' })
    ).toBeVisible()
    await press(s.getByRole('button', { name: 'Add $10', exact: true }))
    await expect(s).toContainText(/Added \$10\.00\./)
    await expect(s).not.toContainText('Quick tips are on')
    await press(s.getByRole('button', { name: 'Back to your tip' }))
    await expect(tipButton(page)).toHaveText('Set up to tip $1')
    expect((await log(page)).signed).toEqual(['deposit'])
  })
})

test.describe('cancelling in the wallet is a choice', () => {
  for (const kind of ['decline', 'close'] as const)
    test(`from a tip (${kind}): back to the same line, one neutral sentence, nothing sent`, async ({
      page,
    }) => {
      await open(page, 'balance=0&connected')
      await toReview(page)
      await answer(page, kind)
      await press(
        sheet(page).getByRole('button', {
          name: 'Add $10 and set up quick tips',
        })
      )
      await expect(page.getByRole('dialog')).toHaveCount(0)
      await expect(
        page.getByText('Nothing was added, and nothing was sent.')
      ).toBeVisible()
      await expect(tipButton(page)).toHaveText('Add money to tip $1')
      await expect(page.locator('[data-chosen]')).toHaveCount(1)
      const after = await log(page)
      expect(after.sent).toEqual([])
      expect(after.tips).toBe(0)
    })

  test('Cancel while the wallet is open: nothing is sent, even if the wallet answers after', async ({
    page,
  }) => {
    await open(page, 'balance=0&connected')
    await toReview(page)
    await answer(page, 'slow')
    await press(
      sheet(page).getByRole('button', { name: 'Add $10 and set up quick tips' })
    )
    await expect(sheet(page)).toContainText('Approve in your wallet.')
    await press(sheet(page).getByRole('button', { name: 'Cancel' }))
    await expect(page.getByRole('dialog')).toHaveCount(0)
    // The wallet answers 3 s after the press: still nothing is sent.
    await page.waitForTimeout(3500)
    expect((await log(page)).sent).toEqual([])
  })

  test('from the balance: back to the amount, with the sentence above it', async ({
    page,
  }) => {
    await open(page, 'connected', '/balance')
    await press(page.getByRole('button', { name: 'Add money' }))
    await press(sheet(page).getByRole('button', { name: 'Review $10' }))
    await answer(page, 'decline')
    await press(
      sheet(page).getByRole('button', { name: 'Add $10', exact: true })
    )
    await expect(sheet(page)).toContainText(
      'Nothing was added, and nothing was sent.'
    )
    await expect(
      sheet(page).getByRole('button', { name: 'Review $10' })
    ).toBeVisible()
  })
})

test.describe('from the balance (B and C)', () => {
  test('a device with no quick tips: money only, the switch off, the consent when it is on', async ({
    page,
  }) => {
    await open(page, 'connected', '/balance')
    await press(page.getByRole('button', { name: 'Add money' }))
    await expect(sheet(page)).toContainText('Add money')
    await press(sheet(page).getByRole('button', { name: 'Review $10' }))
    const s = sheet(page)
    const toggle = s.getByRole('switch', {
      name: 'Also set up quick tips on this device',
    })
    await expect(toggle).toHaveAttribute('aria-checked', 'false')
    await expect(
      s.getByRole('button', { name: 'Add $10', exact: true })
    ).toBeVisible()
    await expect(s).not.toContainText('Tip from your balance on this device')
    await press(toggle)
    await expect(
      s.getByRole('button', { name: 'Add $10 and set up quick tips' })
    ).toBeVisible()
    await expect(s).toContainText('Tip from your balance on this device until')
  })

  test('a set-up device: add and renew, with money only as the quiet choice', async ({
    page,
  }) => {
    await open(page, 'connected&device=ready', '/balance')
    await expect(
      page.getByText(/Quick tips are on for this device until/)
    ).toBeVisible()
    await press(page.getByRole('button', { name: 'Add money' }))
    await press(sheet(page).getByRole('button', { name: 'Review $10' }))
    await expect(
      sheet(page).getByRole('button', { name: 'Add $10 and renew quick tips' })
    ).toBeVisible()
    await expect(sheet(page)).toContainText(
      /This replaces this device's current approval, which allows up to 50 XLM \(≈ \$6\.36\) until /
    )
    await expect(
      sheet(page).getByRole('button', { name: 'Add money only' })
    ).toBeVisible()
  })
})

test('a new reader: confirm the wallet (step 1 of 2), then add (step 2 of 2)', async ({
  page,
}) => {
  await open(page, 'linked=no&balance=0')
  await press(tipButton(page))
  const s = sheet(page)
  await connectAlbedo(page)
  await expect(s).toContainText('Step 1 of 2')
  await expect(s).toContainText(
    'This confirms the wallet is yours. No money moves.'
  )
  await press(s.getByRole('button', { name: 'Confirm wallet' }))
  await press(s.getByRole('button', { name: 'Review $10' }))
  await expect(s).toContainText('Step 2 of 2')
  await press(s.getByRole('button', { name: 'Add $10 and set up quick tips' }))
  await expect(s).toContainText(/Added \$10\.00\./)
  expect((await log(page)).signed).toEqual(['link', 'open_session'])
})

test.describe('what is not a choice stays in the sheet', () => {
  test('a blocked wallet window: Try again, nothing sent', async ({ page }) => {
    await open(page, 'balance=0&connected')
    await toReview(page)
    await answer(page, 'blocked')
    await press(
      sheet(page).getByRole('button', { name: 'Add $10 and set up quick tips' })
    )
    await expect(sheet(page)).toContainText(
      'Your browser blocked the Albedo window. Allow pop-ups for this site, then tap Try again. Nothing was sent.'
    )
    await press(sheet(page).getByRole('button', { name: 'Try again' }))
    await expect(
      sheet(page).getByRole('button', { name: 'Add $10 and set up quick tips' })
    ).toBeVisible()
    expect((await log(page)).sent).toEqual([])
  })

  test('the network lost on the way: offline, Try again', async ({ page }) => {
    await open(page, 'balance=0&connected')
    await press(tipButton(page))
    await answer(page, 'offline')
    await press(sheet(page).getByRole('button', { name: 'Review $10' }))
    await expect(sheet(page)).toContainText(
      'You are offline. Nothing was sent.'
    )
    await press(sheet(page).getByRole('button', { name: 'Try again' }))
    await expect(
      sheet(page).getByRole('button', { name: 'Add $10 and set up quick tips' })
    ).toBeVisible()
  })

  test('a signature made for another network is refused, nothing sent', async ({
    page,
  }) => {
    await open(page, 'balance=0&connected')
    await toReview(page)
    await answer(page, 'wrong-network')
    await press(
      sheet(page).getByRole('button', { name: 'Add $10 and set up quick tips' })
    )
    await expect(sheet(page)).toContainText(
      'Your wallet signed for another network. Switch it to Testnet, then try again. Nothing was sent.'
    )
    expect((await log(page)).sent).toEqual([])
  })

  test('a wallet on another account is refused before signing', async ({
    page,
  }) => {
    await open(page, 'balance=0')
    await toReview(page)
    await press(
      sheet(page).getByRole('button', { name: 'Add $10 and set up quick tips' })
    )
    await answer(page, 'wrong-account')
    await connectAlbedo(page)
    await expect(sheet(page)).toContainText(
      /Switch your wallet to GABC…WXYZ\. That is the wallet linked to your Quilltip account\. Your wallet is on GDEF…STUV\./
    )
    await expect(
      sheet(page).getByRole('button', { name: 'Connect again' })
    ).toBeVisible()
    expect((await log(page)).signed).toEqual([])
  })
})

test.describe('where adding cannot go on, Keep reading is one tap away', () => {
  for (const [query, words] of [
    ['spendable=5', 'Add test XLM to your wallet'],
    ['full', 'Your balance is at its limit'],
    ['price=none', 'Dollar amounts are not available right now'],
    ['paused', 'Adding money is paused on Stellar testnet'],
  ] as const)
    test(`${query}: no amounts, Keep reading`, async ({ page }) => {
      await open(page, `balance=0&${query}`)
      await press(tipButton(page))
      await expect(sheet(page)).toContainText(words)
      await expect(sheet(page).getByRole('radio')).toHaveCount(0)
      await press(sheet(page).getByRole('button', { name: 'Keep reading' }))
      await expect(page.getByRole('dialog')).toHaveCount(0)
      await expect(page.locator('[data-chosen]')).toHaveCount(1)
    })
})

test.describe('quick tips on this device', () => {
  test('ended: "Renew to tip $1" renews with one approval, sends no money and no tip', async ({
    page,
  }) => {
    await open(page, 'balance=40&device=expired&connected')
    await expect(tipButton(page)).toHaveText('Renew to tip $1')
    await press(tipButton(page))
    const s = sheet(page)
    await expect(s).toContainText('Renew quick tips on this device')
    await expect(s).toContainText('Quick tips on this device ended')
    await expect(s).toContainText('No money leaves your balance')
    await press(s.getByRole('button', { name: 'Renew quick tips' }))
    await expect(s).toContainText(/Quick tips are on for this device until/)
    await press(s.getByRole('button', { name: 'Back to your tip' }))
    await expect(tipButton(page)).toHaveText('Tip this line $1')
    const after = await log(page)
    expect(after.signed).toEqual(['register_key'])
    expect(after.tips).toBe(0)
  })

  test('never set up: "Set up to tip $1"; cancelling says nothing was set up', async ({
    page,
  }) => {
    await open(page, 'balance=40&device=none&connected')
    await expect(tipButton(page)).toHaveText('Set up to tip $1')
    await press(tipButton(page))
    await answer(page, 'close')
    await press(sheet(page).getByRole('button', { name: 'Set up quick tips' }))
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await expect(
      page.getByText('Nothing was set up, and nothing was sent.')
    ).toBeVisible()
    await expect(tipButton(page)).toHaveText('Set up to tip $1')
  })

  test('pending: "Finish setup to tip $1"', async ({ page }) => {
    await open(page, 'balance=40&device=pending')
    await expect(tipButton(page)).toHaveText('Finish setup to tip $1')
  })

  test('not checked yet: no button, a waiting line', async ({ page }) => {
    await open(page, 'balance=40&device=unchecked')
    await expect(tipButton(page)).toHaveCount(0)
    await expect(page.locator('[data-fixture="dock-line"]')).toHaveText(
      'Checking this device with Stellar testnet. Tipping waits a moment.'
    )
  })
})

test.describe('turning quick tips off', () => {
  test('another device: off in Quilltip at once, then confirmed by the wallet', async ({
    page,
  }) => {
    await open(page, 'device=ready&other-key', '/balance')
    await expect(page.getByText('Quick tips on your devices')).toBeVisible()
    const rows = page.locator('.qt-quick__device')
    await expect(rows).toHaveCount(2)
    await expect(rows.first()).toContainText('This device')
    await expect(rows.first()).toContainText('Off when you sign out.')
    await expect(rows.nth(1)).toContainText('Another device')
    await expect(rows.nth(1)).toContainText(
      /Ends \w{3} \d{1,2} \w{3}, \d{2}:\d{2}/
    )
    await expect(rows.nth(1)).toContainText(/Used 3 of 50 XLM/)
    await press(rows.nth(1).getByRole('button', { name: 'Turn off' }))
    const s = sheet(page)
    await expect(s).toContainText('Turn off quick tips on another device')
    await expect(s).toContainText(
      'Quilltip stops accepting tips from it at once.'
    )
    await press(s.getByRole('button', { name: 'Turn off quick tips' }))
    await expect.poll(async () => (await log(page)).stopped).toEqual([1])
    // No wallet connected: off in Quilltip, and the wallet confirms next.
    await connectAlbedo(page)
    await expect(s).toContainText(
      'Quick tips are off for this device in Quilltip.'
    )
    await press(s.getByRole('button', { name: 'Confirm in wallet' }))
    await expect(s).toContainText('Quick tips are off for this device.')
    expect((await log(page)).signed).toEqual(['revoke_key:1'])
  })

  test('declined in the wallet: never "nothing changed", and Confirm in wallet stays', async ({
    page,
  }) => {
    await open(page, 'device=ready&connected', '/balance')
    await press(
      page
        .locator('.qt-quick__device')
        .first()
        .getByRole('button', { name: 'Turn off' })
    )
    await answer(page, 'decline')
    await press(
      sheet(page).getByRole('button', { name: 'Turn off quick tips' })
    )
    await expect(sheet(page)).toContainText(
      'Quick tips are off for this device in Quilltip. Your wallet did not confirm it'
    )
    await expect(sheet(page)).not.toContainText('nothing changed')
    await press(sheet(page).getByRole('button', { name: 'Done' }))
    await expect(
      page.locator('.qt-quick__device').first().getByRole('button', {
        name: 'Confirm in wallet',
      })
    ).toBeVisible()
  })
})

test('a withdrawal under way: adding money says it cancels it, on its own button, and is not the primary action', async ({
  page,
}) => {
  await open(page, 'connected&closing', '/balance')
  await press(page.getByRole('button', { name: 'Add money' }))
  const s = sheet(page)
  await expect(s).toContainText(
    'A withdrawal of your balance is under way. Adding money cancels it.'
  )
  await press(s.getByRole('button', { name: 'Review $10' }))
  const keep = s.getByRole('button', { name: 'Keep the withdrawal' })
  const add = s.getByRole('button', {
    name: 'Add $10 and cancel the withdrawal',
  })
  await expect(keep).toHaveAttribute('data-variant', 'primary')
  await expect(add).toHaveAttribute('data-variant', 'secondary')
  await expect(s).not.toContainText('quick tips')
  await press(keep)
  await expect(page.getByRole('dialog')).toHaveCount(0)
  expect((await log(page)).signed).toEqual([])
})

test('nothing moves under the pointer: leaving the amount field with a wrong amount does not move the button', async ({
  page,
}) => {
  await open(page, 'balance=0&connected')
  await press(tipButton(page))
  const s = sheet(page)
  // The deployed contract's 1 XLM floor: the smallest amount is $1.
  await expect(s).toContainText('You can add between $1 and')
  await press(s.getByRole('radio', { name: 'Other' }))
  const field = s.getByLabel('Amount in dollars')
  await field.fill('0.5')
  const review = s.getByRole('button', { name: /^Review/ })
  const before = await review.boundingBox()
  await field.evaluate((el) => (el as HTMLInputElement).blur())
  const after = await review.boundingBox()
  expect(after).toEqual(before)
  // The press lands: the error is said after it, never during it.
  await press(review)
  await expect(s).toContainText('The smallest you can add is $1.')
})

test('the smallest amount is a whole dollar a quarter above the contract floor', async ({
  page,
}) => {
  // A 10 XLM floor on purpose ($1.27 at the fixture's price): $2.
  await open(page, 'balance=0&connected&floor=10')
  await press(tipButton(page))
  const s = sheet(page)
  await expect(s).toContainText('You can add between $2 and')
  await press(s.getByRole('radio', { name: 'Other' }))
  await s.getByLabel('Amount in dollars').fill('1.5')
  await press(s.getByRole('button', { name: /^Review/ }))
  await expect(s).toContainText('The smallest you can add is $2.')
})
