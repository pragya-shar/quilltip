/**
 * Sign-in from a protected route (issue #575), against a local Convex
 * backend with real Convex Auth. Run with `bun run test:e2e:auth`
 * (scripts/auth-e2e/run.ts), which starts the backend and the app.
 *
 * Convex Auth's `signIn` resolves before the backend confirms the new token.
 * A slow confirmation sent the reader back to sign in. `slowAuthConfirmation`
 * holds the backend's messages after the client authenticates, so every run
 * meets that window instead of only some.
 *
 * Sign-in is /signin; the older pages' guards still link to /login, which
 * redirects there with only a safe `returnTo`.
 */
import { createSign } from 'crypto'
import { test, expect, type BrowserContext, type Page } from '@playwright/test'

import { ConvexHttpClient } from 'convex/browser'

import { api } from '../convex/_generated/api'
import { TOKEN_CONFIRMATION_TIMEOUT_MS } from '../lib/auth/sessionConfirmation'
import { CONFIRM_MS } from '../lib/auth/session'

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
  await page.getByRole('button', { name: 'Sign in', exact: true }).click()
}

const loginUrl = (path: string) =>
  `/signin?returnTo=${encodeURIComponent(path)}`
const signInButton = (page: Page) =>
  page.getByRole('button', { name: 'Sign in', exact: true })

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

test('a signed-out reader is sent to sign in and sees no dashboard', async ({
  page,
}) => {
  await watchProtectedContent(page)
  await page.goto('/dashboard/stats')
  await expect(page).toHaveURL(loginUrl('/dashboard/stats'))
  await expect(signInButton(page)).toBeVisible()
  expect(
    await page.evaluate(
      () => (window as unknown as { __sawProtected?: boolean }).__sawProtected
    )
  ).toBe(false)
})

/** Well within TOKEN_CONFIRMATION_TIMEOUT_MS: no wait for an answered token. */
const PROMPT_MS = 5_000

/**
 * A public page that still renders the old header and its navigation menu.
 * `/articles` now redirects to Today, which has the application shell's
 * bar instead. `/support` keeps the old header until the resource pages
 * move to the shell. An unknown writer's page has the header too, but here
 * its not-found answer is a 500: the proxy rewrites it to `localhost` while
 * this server listens on 127.0.0.1.
 */
const OLD_HEADER_PAGE = '/support'

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

  await page.goto(OLD_HEADER_PAGE)
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

test('on Today, a stored token the backend rejects ends as the sign-in link', async ({
  page,
}) => {
  // The application shell's version of the test above, on `/`: the bar's
  // balance item reads Balance while a stored token is unconfirmed (the
  // pre-paint marker), and becomes the link to sign in once the backend
  // rejects it, with nothing of an account shown.
  const namespace = CONVEX_URL!.replace(/[^a-zA-Z0-9]/g, '')
  await page.addInitScript((key) => {
    localStorage.setItem(key, 'not-a-token-this-backend-issued')
  }, `__convexAuthJWT_${namespace}`)
  await page.addInitScript(() => {
    const w = window as unknown as { __sawAccount?: boolean }
    w.__sawAccount = false
    new MutationObserver(() => {
      const bar = document.querySelector('.qt-navbar__item[data-balance]')
      if (
        document.querySelector('a[aria-label^="Your draft:"]') ||
        (bar && /\$/.test(bar.textContent ?? ''))
      )
        w.__sawAccount = true
    }).observe(document, { childList: true, subtree: true })
  })

  await page.goto('/', { waitUntil: 'domcontentloaded' })
  // The token is held, so the item starts as Balance, not Sign in.
  expect(
    await page.evaluate(() =>
      document.documentElement.getAttribute('data-session')
    )
  ).toBe('held')
  const nav = page.getByRole('navigation', { name: 'Main' })
  await expect(nav.getByRole('link', { name: 'Sign in' })).toBeVisible({
    timeout: PROMPT_MS,
  })
  expect(
    await page.evaluate(
      () => (window as unknown as { __sawAccount?: boolean }).__sawAccount
    )
  ).toBe(false)
})

test('a sign-in the backend never answers says so on the sign-in page', async ({
  page,
}) => {
  test.setTimeout(CONFIRM_MS * 2 + 45_000)
  await slowAuthConfirmation(page, 'never')
  await watchProtectedContent(page)
  await page.goto(loginUrl('/dashboard/stats'))
  await signIn(page)
  // Waits for the backend on the sign-in page, saying so, and never goes on
  // to the protected page with a token nobody confirmed.
  await expect(page.getByText('Signing you in…')).toBeVisible()
  const started = Date.now()
  await expect(
    page.getByText('Signing in is taking longer than usual.', { exact: false })
  ).toBeVisible({ timeout: CONFIRM_MS + 10_000 })
  expect(Date.now() - started).toBeGreaterThan(CONFIRM_MS - 3_000)
  await expect(page).toHaveURL(loginUrl('/dashboard/stats'))
  // A second sign-in gets its own wait.
  await signIn(page)
  await expect(page.getByText('Signing you in…')).toBeVisible()
  await staysOn(page, loginUrl('/dashboard/stats'), 3_000)
  expect(
    await page.evaluate(
      () => (window as unknown as { __sawProtected?: boolean }).__sawProtected
    )
  ).toBe(false)
})

test('a signed-in reader’s token names the pair the server answers for, and the balance shows', async ({
  page,
}) => {
  await page.goto(loginUrl('/pocket'))
  await signIn(page)
  await page.waitForURL((url) => url.pathname === '/pocket')

  // The token Convex Auth issued, under this deployment's key.
  const key = `__convexAuthJWT_${CONVEX_URL!.replace(/[^a-zA-Z0-9]/g, '')}`
  const token = await page.evaluate((k) => localStorage.getItem(k), key)
  expect(token, key).toBeTruthy()
  const sub = (
    JSON.parse(
      Buffer.from(token!.split('.')[1]!, 'base64url').toString('utf8')
    ) as { sub: unknown }
  ).sub
  // The pair the money layer binds figures to: the server's own answer.
  const client = new ConvexHttpClient(CONVEX_URL!)
  client.setAuth(token!)
  const session = await client.query(api.balance.session, {})
  expect(session?.sessionId).toBeTruthy()
  expect(sub).toBe(`${session!.userId}|${session!.sessionId}`)

  // A new account holds no balance: an exact zero, shown on /pocket.
  const main = page.getByRole('main')
  await expect(main.getByText('Ready to tip')).toBeVisible()
  await expect(main.getByText('$0.00').first()).toBeVisible()
  // On a page with the bar (/pocket is a pushed screen, with none), its
  // item opens the balance: it states a figure for an open balance only,
  // and never says "Sign in" to a signed-in reader.
  await page.goto('/shelf')
  await expect(
    page.locator('[data-balance]:visible').first()
  ).toHaveAccessibleName(/^Balance/)
})

test('a wrong password shows the error on the form', async ({ page }) => {
  await page.goto('/dashboard/stats')
  await expect(page).toHaveURL(loginUrl('/dashboard/stats'))
  await signIn(page, `${account.password}x`)
  await expect(
    page.getByText('That email and password do not match.')
  ).toBeVisible()
  await expect(page.getByLabel('Password', { exact: true })).toBeFocused()
  await expect(page).toHaveURL(loginUrl('/dashboard/stats'))
})

test('a tip resume after sign-in loads the page in full', async ({ page }) => {
  await slowAuthConfirmation(page)
  const path = '/dashboard/stats?resumeArticleTip=1'
  await page.goto(loginUrl(path))
  await page.evaluate(() => {
    ;(window as unknown as { __samePage?: boolean }).__samePage = true
  })
  await signIn(page)
  await expect(page).toHaveURL(path)
  await expect(PROTECTED[0]!.signedIn(page)).toBeVisible({ timeout: 15_000 })
  // window.location.assign: a new document, not a client-side navigation.
  expect(
    await page.evaluate(
      () => (window as unknown as { __samePage?: boolean }).__samePage
    )
  ).toBeUndefined()
  await staysOn(page, path, 1_000)
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

test('signing out from the dashboard lands on sign in and stays', async ({
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
  await expect(page).toHaveURL('/signin')
  await staysOn(page, '/signin', 2_000)
  await expect(signInButton(page)).toBeVisible()
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
  expect(token).not.toBe(expired)
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

/** How long the sign-out's own navigation to /login (which redirects to
 * /signin) is held (#608). */
const SIGN_OUT_NAVIGATION_HOLD_MS = 3_000

test('a sign-out whose navigation is slow still lands on sign in without a return path', async ({
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
  await expect(page).toHaveURL('/signin', {
    timeout: SIGN_OUT_NAVIGATION_HOLD_MS + 10_000,
  })
  await staysOn(page, '/signin', 2_000)
  expect(held).toBeGreaterThan(0)
  await expect(signInButton(page)).toBeVisible()
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
  await other.goto(OLD_HEADER_PAGE)
  await other.getByRole('button', { name: 'Open navigation menu' }).click()
  await other
    .getByRole('dialog', { name: 'Find your way' })
    .getByRole('button', { name: 'Sign out', exact: true })
    .click()
  await expect(other).toHaveURL('/signin')
  await expect(page).toHaveURL(loginUrl('/dashboard/stats'), {
    timeout: PROMPT_MS,
  })
})

test('someone signed in who opens sign-in goes straight back', async ({
  page,
}) => {
  await page.goto(loginUrl('/shelf'))
  await signIn(page)
  await page.waitForURL((url) => url.pathname === '/shelf')
  await page.goto(loginUrl('/pocket'))
  await page.waitForURL((url) => url.pathname === '/pocket', {
    timeout: PROMPT_MS,
  })
  // Replaced: Back goes to the page before, not to the sign-in page.
  await page.goBack()
  await expect(page).toHaveURL('/shelf')
})

test('a sign-in in another tab is picked up without a reload', async ({
  context,
}) => {
  const page = await context.newPage()
  await page.goto('/shelf')
  const item = page.locator('[data-balance]:visible').first()
  await expect(item).toHaveAccessibleName(/Sign in/)
  const other = await context.newPage()
  await other.goto(loginUrl('/shelf'))
  await signIn(other)
  await other.waitForURL((url) => url.pathname === '/shelf')
  await expect(item).toHaveAccessibleName(/^Balance/, { timeout: PROMPT_MS })
})

test('on the sign-in page, a stored token the backend rejects shows the form', async ({
  page,
}) => {
  const namespace = CONVEX_URL!.replace(/[^a-zA-Z0-9]/g, '')
  await page.addInitScript((key) => {
    localStorage.setItem(key, 'not-a-token-this-backend-issued')
  }, `__convexAuthJWT_${namespace}`)
  await page.goto(loginUrl('/pocket'))
  await expect(page.getByLabel('Email')).toBeVisible({ timeout: PROMPT_MS })
  await expect(page).toHaveURL(loginUrl('/pocket'))
})

test.describe('no page ever asks "Leave page?"', () => {
  /** Fails the test on any dialog: "Leave page?" is a dialog too. */
  const noDialogs = (page: Page) => {
    const seen: string[] = []
    page.on('dialog', (dialog) => {
      seen.push(`${dialog.type()}: ${dialog.message()}`)
      void dialog.dismiss().catch(() => {})
    })
    return seen
  }

  test('signing in on /signin and going back, five times', async ({
    browser,
  }) => {
    // Also measures how long /signin waits between the sign-in's answer
    // reaching the page and its own navigation (a bound of 2 s; logged).
    const waits: number[] = []
    for (let run = 0; run < 5; run++) {
      const context = await browser.newContext()
      const page = await context.newPage()
      const seen = noDialogs(page)
      let answered = 0
      // What the page asks of the backend after the sign-in's answer and
      // before it leaves, by name: writes over the socket, and the auth
      // library's token refresh (an HTTP action), with its start and end.
      const after: string[] = []
      const at = () => (answered ? `${Date.now() - answered} ms` : 'before')
      page.on('websocket', (socket) => {
        socket.on('framereceived', ({ payload }) => {
          if (
            !answered &&
            typeof payload === 'string' &&
            payload.includes('"ActionResponse"') &&
            payload.includes('"success":true')
          )
            answered = Date.now()
        })
        socket.on('framesent', ({ payload }) => {
          if (!answered || typeof payload !== 'string') return
          const write = /"type":"(Mutation|Action)".*?"udfPath":"([^"]+)"/.exec(
            payload
          )
          if (write) after.push(`${write[1]} ${write[2]} at ${at()}`)
        })
      })
      const isRefresh = (request: {
        url(): string
        postData(): string | null
      }) =>
        request.url().includes('/api/action') &&
        (request.postData() ?? '').includes('refreshToken')
      page.on('request', (request) => {
        if (answered && isRefresh(request))
          after.push(`token refresh started at ${at()}`)
      })
      page.on('requestfinished', (request) => {
        if (answered && isRefresh(request))
          after.push(`token refresh ended at ${at()}`)
      })
      let left = 0
      page.on('request', (request) => {
        if (
          !left &&
          request.isNavigationRequest() &&
          new URL(request.url()).pathname === '/pocket'
        ) {
          left = Date.now()
          after.push(`navigation at ${at()}`)
        }
      })
      await page.goto(loginUrl('/pocket'))
      await signIn(page)
      await page.waitForURL((url) => url.pathname === '/pocket')
      await page.waitForTimeout(1_000)
      expect(seen).toEqual([])
      if (answered && left) waits.push(left - answered)
      console.log(
        `${test.info().project.name} run ${run + 1}: ${after.join('; ')}`
      )
      await context.close()
    }
    const sorted = [...waits].sort((a, b) => a - b)
    console.log(
      `sign-in answer to navigation (ms), ${test.info().project.name}: ${sorted.join(', ')}; median ${sorted[Math.floor(sorted.length / 2)]}, worst ${sorted.at(-1)}`
    )
    expect(waits.length).toBe(5)
  })

  test('creating an account on /signin and going back', async ({ page }) => {
    const seen = noDialogs(page)
    await page.goto(
      `/signin?mode=create&returnTo=${encodeURIComponent('/pocket')}`
    )
    await page
      .getByLabel('Email')
      .fill(`new-${Date.now().toString(36)}@example.test`)
    await page
      .getByLabel('Password', { exact: true })
      .fill('a new passphrase for this run')
    await page.getByRole('button', { name: 'Create account' }).click()
    await page.waitForURL((url) => url.pathname === '/pocket')
    await page.waitForTimeout(1_000)
    expect(seen).toEqual([])
  })

  test('asking for a reset code and leaving the reset page', async ({
    page,
  }) => {
    const seen = noDialogs(page)
    await page.goto('/signin/reset')
    await page.getByLabel('Email', { exact: true }).fill(account.email)
    await page.getByRole('button', { name: 'Send a code' }).click()
    await page.waitForTimeout(500)
    await page.goto('/signin')
    await page.waitForTimeout(500)
    expect(seen).toEqual([])
  })
})
