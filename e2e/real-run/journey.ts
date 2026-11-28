/**
 * The balance tip phone journey against the v3 testnet backend, at 390 x 844
 * (iPhone 13 profile in Chromium: touch, mobile viewport). Local and
 * guarded: the target preflight runs first and stops on any mismatch; CI
 * never runs this.
 *
 *   bun e2e/real-run/journey.ts --accounts <file> --expect <env file> \
 *     --profiles <dir> --evidence <dir> --article /<user>/<slug>
 *
 * Inputs, named in the log for every step:
 * - "touch tap": `page.touchscreen.tap` at the centre of a control that is
 *   visible, enabled, inside the viewport and the top element at that point
 *   (`document.elementFromPoint`). No synthetic clicks, no forced clicks.
 * - "touch long-press": Chromium's touch long-press gesture
 *   (`Input.synthesizeTapGesture`, 1.2 s, touch source); Chromium selects
 *   the word under the finger, as a phone does.
 * - "pointer drag": mouse down, move, up across a sentence (a desktop
 *   pointer selection inside the phone profile; there is no scriptable touch
 *   selection-handle drag).
 *
 * Every count is an assertion: it throws, and the run stops, when a tip is
 * not exactly once in the receipts, the reader's activity and the writer's
 * earnings.
 *
 * Sign-in path: sign in, land on /articles, then open the article and the
 * money screens (a direct sign-in to a protected URL bounces to /login
 * before the session settles: issue 575).
 */
import path from 'node:path'
import { arg, phone, preflight, readAccounts } from './lib'
import { startRun, type Receipt, type Run } from './run-kit'

const accounts = readAccounts(arg('--accounts')!)
const profiles = arg('--profiles')!
const evidence = arg('--evidence')!
const article = arg('--article')!
const run: Run = startRun({
  evidence,
  name: 'journey',
  readerAddress: accounts.reader.publicKey,
})

// ---------------------------------------------------------------- the run

await preflight(arg('--expect')!)
run.note('target preflight passed')
const start = new Set(run.receipts().map((r) => r._id))
run.facts.receiptsBefore = start.size

// The writer's phone first, on earnings, so pending shows the moment it lands.
const writer = await phone(path.join(profiles, 'writer'), accounts.writer, {
  videoDir: path.join(evidence, 'video-writer'),
})
await run.hideDevBadge(writer.context)
await run.signedIn(writer.page, accounts.writer)
await writer.page.goto('/dashboard/earnings')
await writer.page.getByTestId('earnings-pending').waitFor({ timeout: 30_000 })
await writer.page.waitForTimeout(2_000)
const earningIds = [
  'earnings-available',
  'earnings-pending',
  'earnings-collected',
]
run.facts.writerBefore = await run.figures(writer.page, earningIds)
run.note(`writer before: ${JSON.stringify(run.facts.writerBefore)}`)
await run.shot(writer.page, '10-writer-earnings-before')

const reader = await phone(path.join(profiles, 'reader'), accounts.reader, {
  videoDir: path.join(evidence, 'video-reader'),
})
await run.hideDevBadge(reader.context)
await reader.context.tracing.start({ screenshots: true, snapshots: true })
const page = reader.page
await run.signedIn(page, accounts.reader)
await page.goto('/dashboard/balance')
await page.getByTestId('balance-available').waitFor({ timeout: 30_000 })
await page.waitForTimeout(2_000)
run.facts.readerBefore = await run.figures(page, ['balance-available'])
run.note(`reader before: ${JSON.stringify(run.facts.readerBefore)}`)
await run.shot(page, '00-reader-balance-before')

await page.goto(article)
await page.locator('.ProseMirror p').first().waitFor()
await page.waitForTimeout(2_000)
await run.shot(page, '01-reading')

// Tip 1: a sentence chosen with a pointer drag, $0.50, one touch tap.
await run.selectByPointer(page, 1, 'Leave it overnight.')
await run.barLive(page)
run.facts.barBefore = await run.bar(page).locator('[role="status"]').innerText()
await run.shot(page, '02-passage-chosen')
await run.chooseAmount(page, '$0.50')
await run.shot(page, '03-amount-50c')
await run.watchPhases(page)
let before = new Set(run.receipts().map((r) => r._id))
await run.tap(page, run.tipButton(page), 'Tip this line $0.50')
await page
  .locator('.qt-tip[data-phase="sent"]')
  .waitFor({ timeout: 20_000 })
  .catch(() => {})
run.facts.tip1Phases = await run.readPhases(page)
run.note(
  `tip 1 phases (ms after the tap): ${JSON.stringify(run.facts.tip1Phases)}`
)
await run.shot(page, '04-sent')
run.facts.barAfter = await run.bar(page).locator('[role="status"]').innerText()
run.note(`bar status after: ${run.facts.barAfter}`)
let fresh = await run.newReceipts(before, 1)
run.assert(fresh.length === 1, `tip 1: ${fresh.length} new receipt (want 1)`)
const tip1 = fresh[0]!
run.facts.tip1 = tip1
await run.expectRows(writer.page, tip1.requestId!, 'writer earnings, tip 1')
run.facts.writerAfterTip1 = await run.figures(writer.page, earningIds)
run.note(`writer after tip 1: ${JSON.stringify(run.facts.writerAfterTip1)}`)
await run.shot(writer.page, '11-writer-earnings-pending')

// Tip 2: a word chosen with a touch long-press, $0.10, a double tap.
await page.waitForTimeout(2_000)
await run.selectByLongPress(page, 2, 'aloud')
await run.barLive(page)
await run.shot(page, '05-long-press-chosen')
const label2 = (await run.tipButton(page).innerText()).trim()
if (!label2.endsWith('$0.10')) await run.chooseAmount(page, '$0.10')
before = new Set(run.receipts().map((r) => r._id))
{
  const box = (await run.tipButton(page).boundingBox())!
  const x = Math.round(box.x + box.width / 2)
  const y = Math.round(box.y + box.height / 2)
  await page.touchscreen.tap(x, y)
  await page.waitForTimeout(60)
  await page.touchscreen.tap(x, y)
  run.note(`touch double tap: tip button at (${x}, ${y}), 60 ms apart`)
}
await page
  .locator('.qt-tip[data-phase="sent"]')
  .waitFor({ timeout: 20_000 })
  .catch(() => {})
await run.shot(page, '06-double-tap-sent')
fresh = await run.newReceipts(before, 1)
run.assert(
  fresh.length === 1,
  `double tap: ${fresh.length} new receipt (want 1)`
)
const tip2 = fresh[0]!
run.facts.tip2 = tip2
await run.expectRows(writer.page, tip2.requestId!, 'writer earnings, tip 2')

// Tip 3: reload while the tip is sending.
await page.waitForTimeout(2_000)
await run.selectByLongPress(page, 3, 'proudest')
await run.barLive(page)
before = new Set(run.receipts().map((r) => r._id))
await run.tap(page, run.tipButton(page), 'tip button, then reload')
await page
  .locator('.qt-tip[data-phase="sending"]')
  .waitFor({ timeout: 5_000 })
  .catch(() => run.note('did not see "sending" before the reload'))
await page.reload()
run.note('reloaded during the send')
fresh = await run.newReceipts(before, 1, 90_000)
run.assert(
  fresh.length === 1,
  `reload during send: ${fresh.length} new receipt (want 1)`
)
const tip3 = fresh[0]!
run.facts.tip3 = tip3
await run.expectRows(writer.page, tip3.requestId!, 'writer earnings, tip 3')

const tips = [tip1, tip2, tip3]
await page.goto('/dashboard/balance')
await page.getByTestId('balance-available').waitFor({ timeout: 30_000 })
await page.waitForTimeout(3_000)
for (const t of tips)
  await run.expectRows(page, t.requestId!, 'reader activity')
run.facts.readerAfterTips = await run.figures(page, ['balance-available'])
await run.shot(page, '07-balance-activity')

// Close the app and open it again with the same storage.
await reader.context.tracing.stop({
  path: path.join(evidence, 'trace-reader.zip'),
})
await reader.context.close()
run.note('reader app closed')
const reopened = await phone(path.join(profiles, 'reader'), accounts.reader, {
  videoDir: path.join(evidence, 'video-reader-reopen'),
})
await run.hideDevBadge(reopened.context)
await run.signedIn(reopened.page, accounts.reader)
await reopened.page.goto('/dashboard/balance')
await reopened.page
  .getByTestId('balance-available')
  .waitFor({ timeout: 30_000 })
await reopened.page.waitForTimeout(3_000)
for (const t of tips)
  await run.expectRows(
    reopened.page,
    t.requestId!,
    'reader activity after reopen'
  )
await run.shot(reopened.page, '08-reopen-balance')
run.assert(
  run.receipts().filter((r) => !start.has(r._id)).length === 3,
  'three tips, three receipts in all'
)

// Settlement: every tip paid on chain, still once on both screens.
const settledBy = Date.now() + 300_000
let settled: Receipt[] = []
while (Date.now() < settledBy) {
  settled = run
    .receipts()
    .filter(
      (r) =>
        tips.some((t) => t._id === r._id) && (r.status as string) === 'SETTLED'
    )
  if (settled.length === tips.length) break
  await new Promise((r) => setTimeout(r, 5_000))
}
run.facts.settledAt = new Date().toISOString()
run.assert(
  settled.length === tips.length,
  `${settled.length} of 3 tips settled`
)
await writer.page.waitForTimeout(4_000)
for (const t of tips) {
  await run.expectRows(writer.page, t.requestId!, 'writer after settlement')
  const status = await writer.page
    .locator(`[data-request-id="${t.requestId}"]`)
    .getAttribute('data-status')
  run.assert(status === 'on-chain', `writer row ${t.requestId} reads ${status}`)
}
run.facts.writerAfterSettlement = await run.figures(writer.page, earningIds)
run.note(
  `writer after settlement: ${JSON.stringify(run.facts.writerAfterSettlement)}`
)
await run.shot(writer.page, '12-writer-earnings-available')
await reopened.page.reload()
await reopened.page
  .getByTestId('balance-available')
  .waitFor({ timeout: 30_000 })
await reopened.page.waitForTimeout(3_000)
for (const t of tips) {
  await run.expectRows(reopened.page, t.requestId!, 'reader after settlement')
  const status = await reopened.page
    .locator(`[data-request-id="${t.requestId}"]`)
    .getAttribute('data-status')
  run.assert(status === 'on-chain', `reader row ${t.requestId} reads ${status}`)
}
run.facts.readerAfterSettlement = await run.figures(reopened.page, [
  'balance-available',
])
await run.shot(reopened.page, '09-reader-after-settlement')
run.facts.tipsAfter = run
  .receipts()
  .filter((r) => tips.some((t) => t._id === r._id))

await reopened.context.close()
await writer.context.close()
run.note('journey done')
run.flush()
