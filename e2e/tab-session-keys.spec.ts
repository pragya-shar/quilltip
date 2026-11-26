/**
 * Tab session keys and voucher signing in real engines (Chromium, Firefox,
 * WebKit), under the app's production content security policy.
 *
 *   bun e2e/fixtures/tab/server.mjs
 *   bunx playwright test --config e2e/fixtures/tab/playwright.config.ts
 */
import { expect, test, type Page } from '@playwright/test'

async function open(page: Page): Promise<void> {
  await page.goto('/')
  await expect(page.locator('#status')).toHaveText('ready')
}

async function reload(page: Page): Promise<void> {
  await page.reload()
  await expect(page.locator('#status')).toHaveText('ready')
}

test.beforeEach(async ({ page }) => {
  await open(page)
  await page.evaluate(() => window.tabFixture.evict())
  await reload(page)
})

test('reports WebCrypto Ed25519 support and no CSP violations', async ({
  page,
  browser,
  browserName,
}) => {
  const support = await page.evaluate(() => window.tabFixture.support())
  console.log(
    `[tab-keys] ${browserName} ${browser.version()} WebCrypto Ed25519: ${support.webCryptoEd25519}`
  )
  expect(support.violations).toEqual([])
})

for (const forceFallback of [false, true]) {
  test(`the ${forceFallback ? 'fallback' : 'default'} vector key signs the shared vector, before and after a reload`, async ({
    page,
    browserName,
  }) => {
    const planted = await page.evaluate(
      (fallback) => window.tabFixture.plantVectorKey(fallback),
      forceFallback
    )
    const first = await page.evaluate(() => window.tabFixture.signVector())
    expect(first.payloadMatches).toBe(true)
    expect(first).toMatchObject({ found: true, verifies: true })
    expect(first.backend).toBe(planted.backend)
    console.log(
      `[tab-keys] ${browserName} ${planted.backend}: deterministic=${first.deterministic} equalsVector=${first.signature === first.expectedSignature}`
    )
    await reload(page)
    const second = await page.evaluate(() => window.tabFixture.signVector())
    expect(second).toMatchObject({ found: true, verifies: true })
    expect(second.publicKey).toBe(first.publicKey)
    // The fallback is RFC 8032 deterministic everywhere. A WebCrypto engine
    // that signs with a random nonce (WebKit) gives valid signatures that
    // differ from the vector bytes; byte equality is required otherwise.
    if (planted.backend === 'noble') expect(first.deterministic).toBe(true)
    if (first.deterministic) {
      expect(first.signature).toBe(first.expectedSignature)
      expect(second.signature).toBe(first.expectedSignature)
    }
  })
}

test('signTabTip reproduces the shared voucher through three receipts', async ({
  page,
}) => {
  await page.evaluate(() => window.tabFixture.plantVectorKey())
  const run = await page.evaluate(() => window.tabFixture.tipSequence())
  expect(run.steps.map((s) => s.kind)).toEqual(['signed', 'signed', 'signed'])
  expect(run.steps[2]!.root).toBe(run.expectedRoot)
  const { deterministic } = await page.evaluate(() =>
    window.tabFixture.signVector()
  )
  if (deterministic) expect(run.steps[2]!.signature).toBe(run.expectedSignature)
  await reload(page)
  const ledger = await page.evaluate(() => window.tabFixture.ledger())
  expect(ledger?.committed?.seq).toBe(3)
  expect(ledger?.committed?.cumulative).toBe('3900000')
})

for (const forceFallback of [false, true]) {
  test(`a generated ${forceFallback ? 'fallback' : 'default'} key persists across a reload`, async ({
    page,
  }) => {
    const created = await page.evaluate(
      (fallback) => window.tabFixture.generate(fallback),
      forceFallback
    )
    if (forceFallback) {
      expect(created.backend).toBe('noble')
      expect(created.extractable).toBe(true)
    } else {
      const { webCryptoEd25519 } = await page.evaluate(() =>
        window.tabFixture.support()
      )
      expect(created.backend).toBe(webCryptoEd25519 ? 'webcrypto' : 'noble')
      expect(created.extractable).toBe(!webCryptoEd25519)
    }
    const before = await page.evaluate(() => window.tabFixture.signGenerated())
    expect(before).toMatchObject({ found: true, verifies: true })
    await reload(page)
    const after = await page.evaluate(() => window.tabFixture.signGenerated())
    expect(after).toMatchObject({
      found: true,
      verifies: true,
      publicKey: created.publicKey,
      backend: created.backend,
    })
    expect(
      await page.evaluate(
        (pk) => window.tabFixture.status(7, pk),
        created.publicKey
      )
    ).toBe('ready')
  })
}

test('missing key: eviction leaves the server key unusable here', async ({
  page,
}) => {
  const created = await page.evaluate(() => window.tabFixture.generate(false))
  expect(await page.evaluate(() => window.tabFixture.tipWithKey(99))).toEqual({
    kind: 'stop',
    reason: 'key_missing',
    message: "This device's quick-tip key is gone.",
  })
  await page.evaluate(() => window.tabFixture.evict())
  await reload(page)
  expect(
    await page.evaluate(
      (pk) => window.tabFixture.status(7, pk),
      created.publicKey
    )
  ).toBe('missing')
  expect(
    await page.evaluate(() => window.tabFixture.tipWithKey(7))
  ).toMatchObject({ kind: 'stop', reason: 'key_missing' })
})

test('two browser tabs commit the same acceptance once', async ({
  page,
  context,
}) => {
  await page.evaluate(() => window.tabFixture.plantVectorKey())
  expect(
    await page.evaluate(() => window.tabFixture.recordFirstPending())
  ).toBe(true)
  const other = await context.newPage()
  await open(other)
  const statuses = await Promise.all([
    page.evaluate(() => window.tabFixture.commitFirst()),
    other.evaluate(() => window.tabFixture.commitFirst()),
  ])
  expect(statuses.sort()).toEqual(['already_committed', 'committed'])
  const ledger = await other.evaluate(() => window.tabFixture.ledger())
  expect(ledger?.committed?.seq).toBe(1)
  await other.close()
})
