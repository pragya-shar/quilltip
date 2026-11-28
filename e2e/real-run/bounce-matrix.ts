/**
 * Sign-in bounce check: arrive signed out on a protected URL, sign in on
 * the login page it redirects to, land back on the URL, then stay 45 s with
 * one client navigation and one reload. Records the URL sequence, auth
 * requests (POST /api/action) and console errors. Fresh context per run.
 *
 *   bun e2e/real-run/bounce-matrix.ts --accounts <file> --who reader \
 *     --url /dashboard/balance --nav Wallet --engine webkit --width phone
 */
import { chromium, devices, webkit } from '@playwright/test'
import { arg, readAccounts } from './lib'

const accounts = readAccounts(arg('--accounts')!)
const who = (arg('--who') ?? 'reader') as 'reader' | 'writer'
const engine = arg('--engine') === 'chromium' ? chromium : webkit
const phone = (arg('--width') ?? 'phone') === 'phone'
const base = arg('--base') ?? 'http://127.0.0.1:3240'
const url = arg('--url') ?? '/dashboard/balance'
const navLabel = arg('--nav') ?? 'Wallet'
const runs = Number(arg('--runs') ?? 5)
const hard = arg('--mode') !== 'client'

const account = accounts[who]
const results: string[] = []
for (let run = 1; run <= runs; run++) {
  const browser = await engine.launch()
  const context = await browser.newContext({
    ...(phone ? devices['iPhone 13'] : devices['Desktop Safari']),
    ...(engine === chromium ? { defaultBrowserType: undefined } : {}),
    viewport: phone
      ? { width: 390, height: 844 }
      : { width: 1440, height: 900 },
    baseURL: base,
  })
  const page = await context.newPage()
  const t0 = Date.now()
  const ts = () => ((Date.now() - t0) / 1000).toFixed(1)
  const log: string[] = []
  page.on('framenavigated', (f) => {
    if (f === page.mainFrame())
      log.push(
        `${ts()} nav ${new URL(f.url()).pathname}${new URL(f.url()).search}`
      )
  })
  page.on('response', (r) => {
    if (/convex\.(cloud|site)\/api\/action/.test(r.url()))
      log.push(`${ts()} auth-action ${r.status()}`)
  })
  page.on('requestfailed', (r) => {
    if (/convex/.test(r.url()))
      log.push(`${ts()} failed ${r.url().slice(0, 80)}`)
  })
  page.on('console', (m) => {
    if (m.type() === 'error')
      log.push(`${ts()} console.error ${m.text().slice(0, 120)}`)
  })
  if (hard) {
    await page.goto(url)
  } else {
    await page.goto('/articles')
    await page.waitForTimeout(2000)
    await page.evaluate((u) => {
      const a = document.createElement('a')
      a.href = u
      document.body.append(a)
      a.click()
    }, url)
  }
  await page.waitForURL(/\/(login|signin)/, { timeout: 30_000 })
  await page.getByLabel('Email', { exact: true }).fill(account.email)
  await page.getByLabel('Password', { exact: true }).fill(account.password)
  await page.getByRole('button', { name: /^(Log in|Sign in)$/ }).click()
  await page
    .waitForURL((u) => u.pathname === url, { timeout: 30_000 })
    .catch(() => {})
  log.push(`${ts()} landed ${new URL(page.url()).pathname}`)
  await page.waitForTimeout(15_000)
  // One client navigation away and back.
  const link = page
    .getByRole('navigation', { name: 'Account sections' })
    .getByRole('link', { name: navLabel })
  if (await link.count()) {
    await link.click()
    await page.waitForTimeout(5_000)
    await page.goBack()
  }
  await page.waitForTimeout(10_000)
  await page.reload()
  await page.waitForTimeout(15_000)
  const final = new URL(page.url()).pathname
  const bounced = log.some(
    (l) => / nav \/login/.test(l) && Number(l.split(' ')[0]) > 5
  )
  results.push(`run ${run}: final ${final}, bounced ${bounced}`)
  console.log(
    `--- run ${run} (${arg('--engine') ?? 'webkit'}, ${phone ? 'phone' : 'desktop'}, ${hard ? 'hard' : 'client'})`
  )
  console.log(log.join('\n'))
  await browser.close()
}
console.log(results.join('\n'))
