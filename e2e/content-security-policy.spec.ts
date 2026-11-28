import { expect, test, type Page } from '@playwright/test'

import { publishedArticlePath } from './helpers/published-article-path'

/**
 * The main routes load under the production content security policy with no
 * violations. Run against a production build (`next start`); development
 * serves no policy.
 */

type Violation = { directive: string; blocked: string; sample: string }

async function recordViolations(page: Page): Promise<() => Promise<string[]>> {
  const consoleErrors: string[] = []
  page.on('console', (message) => {
    if (
      message.type() === 'error' &&
      /Content Security Policy/i.test(message.text())
    )
      consoleErrors.push(message.text())
  })
  await page.addInitScript(() => {
    const store = window as unknown as { __cspViolations: Violation[] }
    store.__cspViolations = []
    document.addEventListener('securitypolicyviolation', (event) => {
      store.__cspViolations.push({
        directive: event.effectiveDirective,
        blocked: event.blockedURI,
        sample: event.sample,
      })
    })
  })
  return async () => {
    const events = await page.evaluate(
      () =>
        (window as unknown as { __cspViolations: Violation[] }).__cspViolations
    )
    return [
      ...events.map(
        (event) =>
          `${event.directive} blocked ${event.blocked || 'inline'} ${event.sample}`
      ),
      ...consoleErrors,
    ]
  }
}

async function expectCleanLoad(page: Page, path: string) {
  const violations = await recordViolations(page)
  const response = await page.goto(path, { waitUntil: 'load' })
  expect(response?.status(), `${path} status`).toBeLessThan(400)

  const policy = response?.headers()['content-security-policy'] ?? ''
  const scriptSrc = policy.match(/(?:^|; )script-src ([^;]+)/)?.[1] ?? ''
  expect(scriptSrc, `${path} script-src`).toMatch(/'nonce-[A-Za-z0-9+/=]+'/)
  expect(scriptSrc).not.toContain("'unsafe-inline'")
  expect(scriptSrc).not.toContain("'unsafe-eval'")

  // Every script in the server HTML carries this response's nonce.
  const nonce = scriptSrc.match(/'nonce-([^']+)'/)?.[1]
  const html = (await response?.text()) ?? ''
  const scripts = html.match(/<script\b[^>]*>/g) ?? []
  expect(scripts.length, `${path} renders scripts`).toBeGreaterThan(0)
  for (const tag of scripts) {
    expect(tag, `${path} script without the response nonce`).toContain(
      `nonce="${nonce}"`
    )
  }

  // Let hydration, lazy chunks and live queries run.
  // A route may keep a request open, so the idle wait is bounded.
  await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {})
  await page.waitForTimeout(1000)
  expect(await violations(), `${path} CSP violations`).toEqual([])
}

for (const path of ['/', '/signin', '/articles', '/wallet/practice']) {
  test(`${path} loads with no CSP violations`, async ({ page }) => {
    await expectCleanLoad(page, path)
  })
}

test('an article page loads with no CSP violations', async ({ page }) => {
  await page.goto('/articles')
  const path = await publishedArticlePath(page)
  test.skip(!path, 'The backend has no published articles')
  await expectCleanLoad(page, path!)
})

test('each response gets a fresh nonce', async ({ request }) => {
  const nonces = await Promise.all(
    [0, 1].map(async () => {
      const response = await request.get('/signin')
      return response
        .headers()
        ['content-security-policy']?.match(/'nonce-([^']+)'/)?.[1]
    })
  )
  expect(nonces[0]).toBeTruthy()
  expect(nonces[0]).not.toBe(nonces[1])
})
