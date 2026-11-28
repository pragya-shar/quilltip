/**
 * The lagging case and one failure case on the v3 testnet backend, phone
 * profile (390 x 844, touch). Local and guarded like `journey.ts`.
 *
 *   bun e2e/real-run/lag.ts --accounts <file> --expect <env file> \
 *     --profiles <dir> --evidence <dir> --article /<user>/<slug>
 *
 * Before it starts, the operator holds settlement on the deployment
 * (`TAB_SETTLE_AFTER_ACCEPT_MS` unset, `TAB_SETTLE_DUE_AGE_MS` at least one
 * hour); the script checks that and stops otherwise. It then:
 * 1. tips once ($0.10) and checks both sides show it once, on its way;
 * 2. turns the reader's network off and taps again: the bar says the reader
 *    is offline and no receipt appears (the failure case, reader side);
 * 3. waits past the lag notice (5 minutes) and checks both sides say the tip
 *    is taking longer;
 * 4. writes `lag-hold-done` to the evidence folder and waits for the tip to
 *    settle once the operator restores the settlement rule; then checks both
 *    sides show it once, paid.
 */
import { spawnSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import path from 'node:path'
import { arg, phone, preflight, readAccounts } from './lib'
import { startRun, type Receipt, type Run } from './run-kit'

const LAG_NOTICE_MS = 5 * 60 * 1000
const accounts = readAccounts(arg('--accounts')!)
const profiles = arg('--profiles')!
const evidence = arg('--evidence')!
const article = arg('--article')!
const run: Run = startRun({
  evidence,
  name: 'lag',
  readerAddress: accounts.reader.publicKey,
})

function envValue(name: string): string | null {
  const out = spawnSync('npx', ['convex', 'env', 'get', name], {
    cwd: path.resolve(import.meta.dirname, '../..'),
    encoding: 'utf8',
  })
  const value = out.stdout.trim()
  return out.status === 0 && value ? value : null
}

await preflight(arg('--expect')!)
run.note('target preflight passed')
const afterAccept = envValue('TAB_SETTLE_AFTER_ACCEPT_MS')
const dueAge = Number(envValue('TAB_SETTLE_DUE_AGE_MS') ?? 0)
run.note(
  `settlement rule: TAB_SETTLE_AFTER_ACCEPT_MS=${afterAccept ?? 'unset'}, TAB_SETTLE_DUE_AGE_MS=${dueAge}`
)
run.assert(
  afterAccept === null && dueAge >= 3_600_000,
  'settlement is held for this run'
)

const writer = await phone(path.join(profiles, 'writer'), accounts.writer, {
  videoDir: path.join(evidence, 'video-lag-writer'),
})
await run.hideDevBadge(writer.context)
await run.signedIn(writer.page, accounts.writer)
await writer.page.goto('/dashboard/earnings')
await writer.page.getByTestId('earnings-pending').waitFor({ timeout: 30_000 })

const reader = await phone(path.join(profiles, 'reader'), accounts.reader, {
  videoDir: path.join(evidence, 'video-lag-reader'),
})
await run.hideDevBadge(reader.context)
const page = reader.page
await run.signedIn(page, accounts.reader)
await page.goto(article)
await page.locator('.ProseMirror p').first().waitFor()
await page.waitForTimeout(2_000)

// 1. One tip, held (or `--held <request id>`: a held tip from an earlier
// attempt of this run, so a restart does not tip again).
const heldId = arg('--held')
let before = new Set(run.receipts().map((r) => r._id))
let held: Receipt
if (heldId) {
  held = run.receipts().find((r) => r.requestId === heldId)!
  run.assert(
    held?.status === 'ACCEPTED',
    `held tip ${heldId} is still accepted`
  )
} else {
  await run.selectByLongPress(page, 3, 'misses')
  await run.barLive(page)
  await run.tap(page, run.tipButton(page), 'tip button')
  await page.locator('.qt-tip[data-phase="sent"]').waitFor({ timeout: 20_000 })
  await run.shot(page, 'lag-01-reader-sent')
  const fresh = await run.newReceipts(before, 1)
  run.assert(
    fresh.length === 1,
    `held tip: ${fresh.length} new receipt (want 1)`
  )
  held = fresh[0]!
  await run.expectRows(writer.page, held.requestId!, 'writer, held tip')
  await run.shot(writer.page, 'lag-02-writer-on-its-way')
}
run.facts.held = held

// 2. Failure, reader side: offline, nothing is sent.
await page.waitForTimeout(2_000)
await run.selectByLongPress(page, 2, 'forgives')
await run.barLive(page)
before = new Set(run.receipts().map((r) => r._id))
await reader.context.setOffline(true)
run.note('reader network off')
await run.tap(page, run.tipButton(page), 'tip button while offline')
await run
  .bar(page)
  .getByText('You are offline. Tip again when you are back online.')
  .waitFor({ timeout: 10_000 })
await run.shot(page, 'fail-01-reader-offline')
await page.waitForTimeout(6_000)
const offlineNew = run.receipts().filter((r) => !before.has(r._id))
run.assert(offlineNew.length === 0, `offline tap: ${offlineNew.length} receipt`)
await reader.context.setOffline(false)
run.note('reader network on')
await page.waitForTimeout(8_000)
run.assert(
  run.receipts().filter((r) => !before.has(r._id)).length === 0,
  'back online: the offline tap was not sent later'
)
await run.shot(page, 'fail-02-reader-back-online')

// 3. Past the lag notice, both sides say it is taking longer.
const lagAt = held.acceptedAt! + LAG_NOTICE_MS + 20_000
run.note(`waiting until ${new Date(lagAt).toISOString()} for the lag notice`)
while (Date.now() < lagAt) await page.waitForTimeout(10_000)
await page.goto('/dashboard/balance')
await page.getByTestId('balance-available').waitFor({ timeout: 30_000 })
await page.waitForTimeout(3_000)
await run.expectRows(page, held.requestId!, 'reader, lagging')
const readerRow = page.locator(`[data-request-id="${held.requestId}"]`)
run.assert(
  (await readerRow.getAttribute('data-lagging')) === 'true',
  'reader row is marked lagging'
)
await run.tap(page, readerRow.getByRole('button').first(), 'the held tip row')
await readerRow
  .getByText('Final. It is taking longer than usual to reach the writer.')
  .waitFor({ timeout: 5_000 })
run.note('reader row detail says it is taking longer than usual')
await run.shot(page, 'lag-03-reader-taking-longer')
await writer.page.waitForTimeout(2_000)
run.assert(
  await writer.page.getByTestId('earnings-lagging').isVisible(),
  'writer sees the lag notice'
)
const writerRow = writer.page.locator(`[data-request-id="${held.requestId}"]`)
run.assert(
  (await writerRow.getAttribute('data-lagging')) === 'true',
  'writer row is marked lagging'
)
run.facts.writerLagging = await run.figures(writer.page, [
  'earnings-available',
  'earnings-pending',
])
await run.shot(writer.page, 'lag-04-writer-lag-notice')

// 4. The operator restores the rule; the tip settles once.
writeFileSync(path.join(evidence, 'lag-hold-done'), new Date().toISOString())
run.note('hold done: restore the settlement rule now')
run.flush()
const until = Date.now() + 20 * 60 * 1000
let status = held.status
while (Date.now() < until && status !== 'SETTLED') {
  await page.waitForTimeout(10_000)
  status = run.receipts().find((r) => r._id === held._id)?.status ?? status
}
run.facts.settledAt = new Date().toISOString()
run.assert(status === 'SETTLED', `held tip ${status}`)
await writer.page.waitForTimeout(4_000)
await run.expectRows(writer.page, held.requestId!, 'writer, settled')
run.assert(
  (await writerRow.getAttribute('data-status')) === 'on-chain' &&
    !(await writer.page.getByTestId('earnings-lagging').isVisible()),
  'writer row paid, lag notice gone'
)
run.facts.writerSettled = await run.figures(writer.page, [
  'earnings-available',
  'earnings-pending',
])
await run.shot(writer.page, 'lag-05-writer-settled')
await page.reload()
await page.getByTestId('balance-available').waitFor({ timeout: 30_000 })
await page.waitForTimeout(3_000)
await run.expectRows(page, held.requestId!, 'reader, settled')
run.assert(
  (await readerRow.getAttribute('data-status')) === 'on-chain',
  'reader row paid'
)
await run.shot(page, 'lag-06-reader-settled')

await reader.context.close()
await writer.context.close()
run.note('lag run done')
run.flush()
