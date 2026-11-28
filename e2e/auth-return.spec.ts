/**
 * Sign-in from a protected route (issue #575), against a local Convex
 * backend with real Convex Auth. Run with `bun run test:e2e:auth`
 * (scripts/auth-e2e/run.ts), which starts the backend and the app.
 *
 * Convex Auth's `signIn` resolves before the backend confirms the new token.
 * A slow confirmation sent the reader back to /login. `slowAuthConfirmation`
 * holds the backend's messages after the client authenticates, so every run
 * meets that window instead of only some.
 */
import { createSign } from 'crypto'
import { test, expect, type BrowserContext, type Page } from '@playwright/test'
import {
  accountRow,
  addTwoSections,
  expectCurrentInView,
  expectKeyboardReachesEveryLink,
  expectMenuButtonWorks,
  pageOverflow,
} from './helpers/accountRow'

import { TOKEN_CONFIRMATION_TIMEOUT_MS } from '../lib/auth/sessionConfirmation'

const CONVEX_URL = process.env.AUTH_E2E_CONVEX_URL
/** How long the backend's answer is held after the client authenticates. */
const CONFIRMATION_DELAY_MS = 2_000

/** Made by the runner on the local backend for this run. */
const account = {
  email: process.env.AUTH_E2E_EMAIL ?? '',
  password: process.env.AUTH_E2E_PASSWORD ?? '',
}

test.skip(
  !CONVEX_URL || !account.email,
  'Needs the local backend: bun run test:e2e:auth'
)

/**
 * Holds every backend message for CONFIRMATION_DELAY_MS after the client
 * sends a user token, in order. The sign-in itself is answered at once.
 */
async function slowAuthConfirmation(
  page: Page,
  /**
   * 'never' drops the backend's messages instead, so it never answers the
   * token; action results still pass, so the reader can sign in again.
   */
  hold: number | 'never' = CONFIRMATION_DELAY_MS
) {
  await page.routeWebSocket(/\/api\/[^/]+\/sync/, (ws) => {
    const server = ws.connectToServer()
    let holdUntil = 0
    let silent = false
    let delivered = Promise.resolve()
    ws.onMessage((message) => {
      if (typeof message === 'string' && message.includes('"Authenticate"')) {
        const parsed = JSON.parse(message) as { tokenType?: string }
        if (parsed.tokenType === 'User') {
          if (hold === 'never') silent = true
          else holdUntil = Date.now() + hold
        }
      }
      server.send(message)
    })
    server.onMessage((message) => {
      if (silent) {
        if (typeof message === 'string' && message.includes('"ActionResponse"'))
          ws.send(message)
        return
      }
      const wait = holdUntil - Date.now()
      delivered = delivered
        .then(() =>
          wait > 0 ? new Promise((r) => setTimeout(r, wait)) : undefined
        )
        .then(() => ws.send(message))
    })
  })
}

/** Records whether signed-in dashboard content ever entered the page. */
async function watchProtectedContent(page: Page) {
  await page.addInitScript(() => {
    const w = window as unknown as { __sawProtected?: boolean }
    w.__sawProtected = false
    new MutationObserver(() => {
      if (document.querySelector('.account-stats:not([role="status"])')) {
        w.__sawProtected = true
      }
    }).observe(document, { childList: true, subtree: true })
  })
}

async function signIn(page: Page, password = account.password) {
  await page.getByLabel('Email').fill(account.email)
  await page.getByLabel('Password', { exact: true }).fill(password)
  await page.getByRole('button', { name: 'Log in' }).click()
}

const loginUrl = (path: string) => `/login?returnTo=${encodeURIComponent(path)}`

/** Stays on the path for the whole interval. */
async function staysOn(page: Page, path: string, ms: number) {
  const left: string[] = []
  const onNavigate = () => {
    const url = new URL(page.url())
    if (url.pathname + url.search !== path) left.push(url.pathname + url.search)
  }
  page.on('framenavigated', onNavigate)
  await page.waitForTimeout(ms)
  page.off('framenavigated', onNavigate)
  expect(left, `left ${path}`).toEqual([])
  expect(new URL(page.url()).pathname + new URL(page.url()).search).toBe(path)
}

const PROTECTED = [
  {
    path: '/dashboard/stats',
    signedIn: (page: Page) =>
      page.locator('.account-stats:not([role="status"])').getByRole('heading', {
        name: 'Stats',
        exact: true,
      }),
  },
  {
    path: '/settings',
    signedIn: (page: Page) =>
      page.getByRole('heading', { name: 'Profile', exact: true }),
  },
  {
    path: '/write',
    signedIn: (page: Page) => page.getByPlaceholder('Give it a title'),
  },
]

for (const route of PROTECTED) {
  test(`a sign-in from ${route.path} reaches it and stays`, async ({
    page,
  }) => {
    await slowAuthConfirmation(page)
    await page.goto(route.path)
    await expect(page).toHaveURL(loginUrl(route.path))
    await signIn(page)
    await expect(route.signedIn(page)).toBeVisible({ timeout: 15_000 })
    await staysOn(page, route.path, CONFIRMATION_DELAY_MS + 1_000)
    await expect(route.signedIn(page)).toBeVisible()
  })
}

test('a signed-out reader is sent to login and sees no dashboard', async ({
  page,
}) => {
  await watchProtectedContent(page)
  await page.goto('/dashboard/stats')
  await expect(page).toHaveURL(loginUrl('/dashboard/stats'))
  await expect(page.getByRole('button', { name: 'Log in' })).toBeVisible()
  expect(
    await page.evaluate(
      () => (window as unknown as { __sawProtected?: boolean }).__sawProtected
    )
  ).toBe(false)
})

/** Well within TOKEN_CONFIRMATION_TIMEOUT_MS: no wait for an answered token. */
const PROMPT_MS = 5_000

test('a stored token the backend rejects does not hold a signed-out reader', async ({
  page,
}) => {
  // No refresh token: Convex Auth keeps the rejected token in storage.
  const namespace = CONVEX_URL!.replace(/[^a-zA-Z0-9]/g, '')
  await page.addInitScript((key) => {
    localStorage.setItem(key, 'not-a-token-this-backend-issued')
  }, `__convexAuthJWT_${namespace}`)
  await watchProtectedContent(page)

  await page.goto('/dashboard/stats')
  await expect(page).toHaveURL(loginUrl('/dashboard/stats'), {
    timeout: PROMPT_MS,
  })

  await page.goto('/articles')
  await page.getByRole('button', { name: 'Open navigation menu' }).click()
  await expect(
    page
      .getByRole('dialog', { name: 'Find your way' })
      .getByRole('link', { name: 'Log in', exact: true })
  ).toBeVisible({ timeout: PROMPT_MS })
  expect(
    await page.evaluate(
      () => (window as unknown as { __sawProtected?: boolean }).__sawProtected
    )
  ).toBe(false)
})

test('a sign-in the backend never answers ends on login at the bound', async ({
  page,
}) => {
  test.setTimeout(TOKEN_CONFIRMATION_TIMEOUT_MS + 45_000)
  await slowAuthConfirmation(page, 'never')
  await watchProtectedContent(page)
  await page.goto(loginUrl('/dashboard/stats'))
  await signIn(page)
  await expect(page).toHaveURL('/dashboard/stats')
  const landed = Date.now()
  // Waits for the answer: no redirect well before the bound.
  await staysOn(page, '/dashboard/stats', TOKEN_CONFIRMATION_TIMEOUT_MS - 3_000)
  // Then treats the reader as signed out.
  await expect(page).toHaveURL(loginUrl('/dashboard/stats'), {
    timeout: 10_000,
  })
  expect(Date.now() - landed).toBeLessThan(
    TOKEN_CONFIRMATION_TIMEOUT_MS + 8_000
  )
  // A second sign-in stores a new token, which gets its own wait.
  await signIn(page)
  await expect(page).toHaveURL('/dashboard/stats')
  await staysOn(page, '/dashboard/stats', 5_000)
  expect(
    await page.evaluate(
      () => (window as unknown as { __sawProtected?: boolean }).__sawProtected
    )
  ).toBe(false)
})

test('a wrong password shows the error on the form', async ({ page }) => {
  await page.goto('/dashboard/stats')
  await expect(page).toHaveURL(loginUrl('/dashboard/stats'))
  await signIn(page, `${account.password}x`)
  await expect(
    page.getByRole('alert').filter({ hasText: 'Invalid email or password' })
  ).toHaveText('Invalid email or password. Please try again.')
  await expect(page).toHaveURL(loginUrl('/dashboard/stats'))
})

/** Wallet choices kept in this browser (#562), by storage key. */
const walletKeys = (page: Page) =>
  page.evaluate(() =>
    Object.keys(localStorage)
      .filter(
        (key) =>
          key.startsWith('quilltip:wallet:v1:') ||
          key.startsWith('@StellarWalletsKit/')
      )
      .sort()
  )

for (const width of [375, 390, 412]) {
  test(`the account sections row fits a ${width} px screen (#635)`, async ({
    page,
    browserName,
  }) => {
    await page.setViewportSize({ width, height: 812 })
    await page.goto(loginUrl('/dashboard/stats'))
    await signIn(page)
    await expect(PROTECTED[0]!.signedIn(page)).toBeVisible({ timeout: 15_000 })
    const row = accountRow(page)

    // Each section as it ships: no sideways page scroll, and the current
    // section's link fully in view on load.
    const hrefs = await row
      .getByRole('link')
      .evaluateAll((links) => links.map((link) => link.getAttribute('href')!))
    expect(hrefs.length).toBeGreaterThan(0)
    for (const href of hrefs) {
      await page.goto(href)
      await expectCurrentInView(page)
      expect(await pageOverflow(page), href).toBeLessThanOrEqual(0)
    }

    // A move between sections inside the app: the row stays mounted and
    // shows the new current link. A script click, because Playwright's own
    // click scrolls the link into view first.
    await page.goto(hrefs[0]!)
    await expectCurrentInView(page)
    await row
      .getByRole('link')
      .last()
      .evaluate((link: HTMLElement) => link.click())
    await expect(page).toHaveURL(hrefs.at(-1)!)
    await expectCurrentInView(page)

    await expectKeyboardReachesEveryLink(page, browserName)
    expect(await pageOverflow(page)).toBeLessThanOrEqual(0)
    await expectMenuButtonWorks(page)

    // Two more sections than ship today, added by the test only.
    await addTwoSections(page)
    expect(await pageOverflow(page)).toBeLessThanOrEqual(0)
    expect(
      await row.evaluate((element) => element.scrollWidth > element.clientWidth)
    ).toBe(true)
    await expectKeyboardReachesEveryLink(page, browserName)
    expect(await pageOverflow(page)).toBeLessThanOrEqual(0)
    await expectMenuButtonWorks(page)
  })
}

test('signing out from the dashboard lands on login and stays', async ({
  page,
}) => {
  await page.goto(loginUrl('/dashboard/stats'))
  await signIn(page)
  await expect(PROTECTED[0]!.signedIn(page)).toBeVisible({ timeout: 15_000 })
  // A remembered wallet choice, as the wallet restore stores it.
  await page.evaluate(() => {
    localStorage.setItem(
      'quilltip:wallet:v1:k17returnpathreader',
      JSON.stringify({
        walletId: 'freighter',
        address: `G${'A'.repeat(55)}`,
      })
    )
    localStorage.setItem('@StellarWalletsKit/selectedModuleId', 'freighter')
  })
  // The wallet kit may add keys of its own once it loads.
  expect(await walletKeys(page)).toEqual(
    expect.arrayContaining([
      '@StellarWalletsKit/selectedModuleId',
      'quilltip:wallet:v1:k17returnpathreader',
    ])
  )
  await page.getByRole('button', { name: 'Open navigation menu' }).click()
  await page
    .getByRole('dialog', { name: 'Find your way' })
    .getByRole('button', { name: 'Sign out', exact: true })
    .click()
  await expect(page).toHaveURL('/login')
  await staysOn(page, '/login', 2_000)
  await expect(page.getByRole('button', { name: 'Log in' })).toBeVisible()
  // Signed out, the browser keeps no wallet choice.
  await expect.poll(() => walletKeys(page)).toEqual([])
})

/*
 * A returning reader whose stored token has expired, with the refresh token
 * still stored. The runner passes this run's throwaway signing key, so the
 * copy is signed like a real token; only its expiry differs.
 *
 * These tests guard the refresh path of a returning reader. They do not
 * guard the #575 wait: on this path `useConvexAuth()` reports loading until
 * the refreshed token is confirmed, so they pass without that wait.
 */
const JWT_PRIVATE_KEY = process.env.AUTH_E2E_JWT_PRIVATE_KEY ?? ''
const jwtStorageKey = () =>
  `__convexAuthJWT_${CONVEX_URL!.replace(/[^a-zA-Z0-9]/g, '')}`

/** The runner keeps the PEM on one line; restore its line breaks. */
function pem(key: string): string {
  const body = key
    .replace('-----BEGIN PRIVATE KEY-----', '')
    .replace('-----END PRIVATE KEY-----', '')
    .replace(/\s+/g, '')
  return `-----BEGIN PRIVATE KEY-----\n${body.match(/.{1,64}/g)!.join('\n')}\n-----END PRIVATE KEY-----\n`
}

const claimsOf = (jwt: string) =>
  JSON.parse(Buffer.from(jwt.split('.')[1]!, 'base64url').toString()) as {
    exp: number
  }

/**
 * The same claims, signed with the backend's key, expiring `expiresIn`
 * seconds from now (negative: already expired).
 */
function resigned(jwt: string, expiresIn: number): string {
  const now = Math.floor(Date.now() / 1000)
  const encode = (value: object) =>
    Buffer.from(JSON.stringify(value)).toString('base64url')
  const head = encode({ alg: 'RS256' })
  const body = encode({
    ...claimsOf(jwt),
    iat: now - 7200,
    exp: now + expiresIn,
  })
  const signature = createSign('RSA-SHA256')
    .update(`${head}.${body}`)
    .sign(pem(JWT_PRIVATE_KEY))
    .toString('base64url')
  return `${head}.${body}.${signature}`
}

/** Counts document loads per tab, so a reload loop shows. */
async function countLoads(context: BrowserContext) {
  await context.addInitScript(() => {
    const count = Number(sessionStorage.getItem('authE2eLoads') ?? '0')
    sessionStorage.setItem('authE2eLoads', String(count + 1))
  })
}
const loadsOf = (page: Page) =>
  page.evaluate(() => Number(sessionStorage.getItem('authE2eLoads')))
const storedToken = (page: Page) =>
  page.evaluate((key) => localStorage.getItem(key), jwtStorageKey())

/** Convex Auth's refresh: `auth:signIn` over HTTP with the refresh token. */
const isRefresh = (url: string, body: string | null) =>
  url.includes('/api/action') && (body ?? '').includes('refreshToken')

/** Counts refresh requests across every tab of the context. */
function countRefreshes(context: BrowserContext): () => number {
  let count = 0
  context.on('request', (request) => {
    if (isRefresh(request.url(), request.postData())) count++
  })
  return () => count
}

/** The backend's `AuthError` messages to this tab, by error text. */
function authErrors(page: Page): string[] {
  const errors: string[] = []
  page.on('websocket', (ws) => {
    ws.on('framereceived', ({ payload }) => {
      if (typeof payload !== 'string' || !payload.includes('"AuthError"'))
        return
      const message = JSON.parse(payload) as { type?: string; error?: string }
      if (message.type === 'AuthError') errors.push(message.error ?? '')
    })
  })
  return errors
}

/**
 * Signs in, then leaves a re-signed copy of the token in storage with the
 * refresh token, as a reader returning hours later has, and closes the tab.
 * It waits for the refresh that follows sign-in, so that refresh cannot
 * overwrite the copy.
 */
async function returningReader(
  context: BrowserContext,
  expiresIn = -3600
): Promise<string> {
  const page = await context.newPage()
  const firstRefresh = page.waitForResponse((response) =>
    isRefresh(response.url(), response.request().postData())
  )
  await page.goto(loginUrl('/dashboard/stats'))
  await signIn(page)
  await expect(PROTECTED[0]!.signedIn(page)).toBeVisible({ timeout: 15_000 })
  await firstRefresh
  const token = await storedToken(page)
  expect(token).not.toBeNull()
  const copy = resigned(token!, expiresIn)
  await page.evaluate(({ key, value }) => localStorage.setItem(key, value), {
    key: jwtStorageKey(),
    value: copy,
  })
  await page.close()
  return copy
}

/** The backend's answer to an expired token. */
const EXPIRED_TOKEN_ERROR = 'Could not verify OIDC token claim'

/** Ends on the dashboard in one load, with a new, unexpired token. */
async function expectRefreshedInOneLoad(page: Page, expired: string) {
  await expect(PROTECTED[0]!.signedIn(page)).toBeVisible({
    timeout: TOKEN_CONFIRMATION_TIMEOUT_MS,
  })
  await staysOn(page, '/dashboard/stats', 3_000)
  expect(await loadsOf(page)).toBe(1)
  const token = await storedToken(page)
  expect(token).not.toBeNull()
  // A boolean, so a failure prints no token in the job log.
  expect(token === expired, 'the expired token was replaced').toBe(false)
  expect(claimsOf(token!).exp).toBeGreaterThan(Date.now() / 1000)
}

test.describe('a returning reader with an expired token', () => {
  test.skip(
    !JWT_PRIVATE_KEY,
    'Needs the run signing key: bun run test:e2e:auth'
  )

  test('is refused by the backend, then refreshed in one load', async ({
    context,
  }) => {
    await countLoads(context)
    const expired = await returningReader(context)
    const page = await context.newPage()
    const errors = authErrors(page)
    await page.goto('/dashboard/stats')
    await expectRefreshedInOneLoad(page, expired)
    expect(errors.some((error) => error.includes(EXPIRED_TOKEN_ERROR))).toBe(
      true
    )
  })

  // Control: the same copy with an expiry ahead is accepted, so only the
  // expiry made the backend refuse the copy above.
  test('the same copy unexpired is accepted', async ({ context }) => {
    await countLoads(context)
    await returningReader(context, 3600)
    const page = await context.newPage()
    const errors = authErrors(page)
    await page.goto('/dashboard/stats')
    await expect(PROTECTED[0]!.signedIn(page)).toBeVisible({
      timeout: TOKEN_CONFIRMATION_TIMEOUT_MS,
    })
    expect(await loadsOf(page)).toBe(1)
    expect(errors).toEqual([])
  })

  test('in two tabs loading at once, both stay signed in', async ({
    context,
  }) => {
    await countLoads(context)
    const expired = await returningReader(context)
    const refreshes = countRefreshes(context)
    const tabs = [await context.newPage(), await context.newPage()]
    await Promise.all(tabs.map((tab) => tab.goto('/dashboard/stats')))
    for (const tab of tabs) await expectRefreshedInOneLoad(tab, expired)
    // The client serialises the refresh with a browser lock. The second tab
    // skips its refresh only if the first tab's new token has already
    // reached it through storage, so one or two refreshes, and no loop.
    expect(refreshes()).toBeGreaterThanOrEqual(1)
    expect(refreshes()).toBeLessThanOrEqual(2)
    // The session survives: a reload is still signed in.
    await tabs[0]!.reload()
    await expect(PROTECTED[0]!.signedIn(tabs[0]!)).toBeVisible({
      timeout: TOKEN_CONFIRMATION_TIMEOUT_MS,
    })
  })
})

/** How long the sign-out's own navigation to /login is held (#608). */
const SIGN_OUT_NAVIGATION_HOLD_MS = 3_000

test('a sign-out whose navigation is slow still lands on login without a return path', async ({
  page,
}) => {
  await page.goto(loginUrl('/dashboard/stats'))
  await signIn(page)
  await expect(PROTECTED[0]!.signedIn(page)).toBeVisible({ timeout: 15_000 })
  // A full load of the dashboard, so the client router has no /login route
  // cached and its navigation must wait for the server.
  await page.goto('/dashboard/stats')
  await expect(PROTECTED[0]!.signedIn(page)).toBeVisible({ timeout: 15_000 })
  // Hold that navigation to plain /login, so the sign-out completes and the
  // dashboard's guard runs while the navigation is pending.
  let held = 0
  await page.route(
    (url) => url.pathname === '/login' && !url.searchParams.has('returnTo'),
    async (route) => {
      if (route.request().headers()['rsc'] === '1') {
        held++
        await new Promise((r) => setTimeout(r, SIGN_OUT_NAVIGATION_HOLD_MS))
      }
      await route.continue()
    }
  )
  await page.getByRole('button', { name: 'Open navigation menu' }).click()
  await page
    .getByRole('dialog', { name: 'Find your way' })
    .getByRole('button', { name: 'Sign out', exact: true })
    .click()
  await expect(page).toHaveURL('/login', {
    timeout: SIGN_OUT_NAVIGATION_HOLD_MS + 10_000,
  })
  await staysOn(page, '/login', 2_000)
  expect(held).toBeGreaterThan(0)
  await expect(page.getByRole('button', { name: 'Log in' })).toBeVisible()
})

test('a session ended in another tab keeps the return path', async ({
  context,
}) => {
  const page = await context.newPage()
  await page.goto(loginUrl('/dashboard/stats'))
  await signIn(page)
  await expect(PROTECTED[0]!.signedIn(page)).toBeVisible({ timeout: 15_000 })
  // This tab did not sign out: its guard keeps the reader's place.
  const other = await context.newPage()
  await other.goto('/articles')
  await other.getByRole('button', { name: 'Open navigation menu' }).click()
  await other
    .getByRole('dialog', { name: 'Find your way' })
    .getByRole('button', { name: 'Sign out', exact: true })
    .click()
  await expect(other).toHaveURL('/login')
  await expect(page).toHaveURL(loginUrl('/dashboard/stats'), {
    timeout: PROMPT_MS,
  })
})

// The toaster loads after the page (components/providers/Providers.tsx) and
// holds each toast until its empty live region has existed for two frames
// (components/ui/sonner.tsx). The worst case: a toast raised while the
// toaster's own code has not arrived. Its chunk is held back here; the
// profile save raises "Profile saved" in that time (the form imports sonner
// itself). Once the chunk arrives, the region must be added empty first and
// the toast added into it at least two frames later. In Chromium the
// accessibility tree, which screen readers read, must show the live region
// before the message. It cannot show what a screen reader speaks, and
// Playwright cannot read WebKit's accessibility tree.
test('a toast raised before the toaster loads goes into a live region that already exists', async ({
  page,
  browserName,
}) => {
  let release!: () => void
  const released = new Promise<void>((resolve) => (release = resolve))
  let held = 0
  await page.route('**/_next/static/chunks/*.js', async (route) => {
    const response = await route.fetch()
    const body = await response.text()
    // The toaster's chunk is the one that carries its holding id.
    if (body.includes('quilltip-region-not-ready')) {
      held += 1
      await released
    }
    await route.fulfill({ response, body })
  })
  await page.addInitScript(() => {
    const log: { what: string; frame: number }[] = []
    ;(window as unknown as { __toastLog: typeof log }).__toastLog = log
    let frame = 0
    const tick = () => {
      frame += 1
      requestAnimationFrame(tick)
    }
    requestAnimationFrame(tick)
    const counted = new WeakSet<Element>()
    new MutationObserver((records) => {
      for (const record of records)
        for (const node of record.addedNodes) {
          if (!(node instanceof Element)) continue
          for (const element of [
            node,
            ...node.querySelectorAll('section[aria-live], [data-sonner-toast]'),
          ]) {
            if (counted.has(element)) continue
            if (element.matches('section[aria-live]')) {
              counted.add(element)
              log.push({ what: 'region', frame })
            } else if (element.matches('[data-sonner-toast]')) {
              counted.add(element)
              log.push({ what: `toast: ${element.textContent}`, frame })
            }
          }
        }
    }).observe(document, { childList: true, subtree: true })
  })

  await page.goto(loginUrl('/settings/profile'))
  await signIn(page)
  await expect(page).toHaveURL('/settings/profile', { timeout: PROMPT_MS })
  await expect(page.getByLabel('Display name', { exact: true })).toBeVisible()
  expect(held, 'the toaster chunk was requested and held').toBeGreaterThan(0)
  const region = page.getByRole('region', { name: /Notifications/ })
  await expect(region).toHaveCount(0)

  // Save the current name unchanged, so the account is left as it was. The
  // form calls toast.success before its button reads "Save profile" again.
  const save = page.getByRole('button', { name: 'Save profile', exact: true })
  await save.click()
  await expect(page.getByRole('button', { name: 'Saving…' })).toBeHidden({
    timeout: PROMPT_MS,
  })
  await expect(save).toBeEnabled()
  await expect(region).toHaveCount(0)

  // Chromium: watch the accessibility tree while the toaster arrives.
  const cdp =
    browserName === 'chromium' ? await page.context().newCDPSession(page) : null
  const tree: string[] = []
  const watchTree = async () => {
    if (!cdp) return
    await cdp.send('Accessibility.enable')
    for (let i = 0; i < 400; i++) {
      const { nodes } = (await cdp.send('Accessibility.getFullAXTree')) as {
        nodes: { role?: { value?: string }; name?: { value?: string } }[]
      }
      const hasRegion = nodes.some(
        (node) =>
          node.role?.value === 'region' &&
          /Notifications/.test(node.name?.value ?? '')
      )
      const hasMessage = nodes.some((node) =>
        (node.name?.value ?? '').includes('Profile saved')
      )
      const state = hasMessage
        ? 'message'
        : hasRegion
          ? 'region only'
          : 'no region'
      if (tree[tree.length - 1] !== state) tree.push(state)
      if (hasMessage) return
    }
  }
  const watching = watchTree()
  release()
  await expect(region.getByText('Profile saved', { exact: true })).toBeVisible()
  await watching
  await expect(region).toHaveAttribute('aria-live', 'polite')

  const log = await page.evaluate(
    () =>
      (window as unknown as { __toastLog: { what: string; frame: number }[] })
        .__toastLog
  )
  console.log(`${browserName} additions: ${JSON.stringify(log)}`)
  if (cdp)
    console.log(`${browserName} accessibility tree: ${tree.join(' -> ')}`)
  expect(log).toHaveLength(2)
  expect(log[0]!.what).toBe('region')
  expect(log[1]!.what).toContain('Profile saved')
  expect(log[1]!.frame - log[0]!.frame).toBeGreaterThanOrEqual(2)
  if (cdp) {
    expect(tree).toContain('region only')
    expect(tree.indexOf('region only')).toBeLessThan(tree.indexOf('message'))
  }
})
