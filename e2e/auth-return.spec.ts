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
import { test, expect, type Page } from '@playwright/test'

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
