import { expect, test, type Page } from '@playwright/test'
import { FIXTURE_ARTICLE_PATH } from '../scripts/perf/convex-fixture'

/**
 * Forms in the server HTML that carry a password or personal data post if
 * they are ever submitted natively, so their values never go into a URL.
 *
 * The pages load with JavaScript turned off, so the DOM is the server HTML
 * as the browser parsed it, including content React streams in a later
 * segment. Run against a production build (`bun run test:e2e:early-taps`).
 */

/** Pages with a form a reader can fill in before the page scripts run. */
const FORM_PAGES = [
  '/signin',
  '/signin?mode=create',
  '/signin/reset',
  '/waitlist',
]

/** Pages whose forms render only after the scripts know who is signed in. */
const SIGNED_IN_PAGES = [
  '/settings',
  '/settings/profile',
  '/welcome',
  '/dashboard/feedback',
  '/write',
]

/** Pages that should carry no such form. */
const READING_PAGES = ['/', FIXTURE_ARTICLE_PATH, '/support']

/** Field types and autocomplete tokens that carry a secret or personal data. */
const PERSONAL_TYPES = ['password', 'email', 'tel']
const PERSONAL_AUTOCOMPLETE = [
  'current-password',
  'new-password',
  'one-time-code',
  'email',
  'username',
  'name',
  'nickname',
  'tel',
]

interface ServerForm {
  method: string | null
  hasPassword: boolean
  /** Named fields that carry personal data; a native GET puts these in the URL. */
  personalNamed: string[]
  /** Every field that carries personal data, named or not. */
  personal: string[]
}

async function serverForms(page: Page, path: string): Promise<ServerForm[]> {
  const response = await page.goto(path, { waitUntil: 'domcontentloaded' })
  expect(response?.status(), `${path} status`).toBeLessThan(400)
  return page.locator('form').evaluateAll(
    (forms, { types, tokens }) =>
      forms.map((form) => {
        const fields = [
          ...form.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>(
            'input, textarea'
          ),
        ]
        const personal = fields.filter((field) => {
          const type = field.getAttribute('type') ?? 'text'
          const tokensOnField = (field.getAttribute('autocomplete') ?? '')
            .toLowerCase()
            .split(/\s+/)
          return (
            types.includes(type) ||
            tokensOnField.some((token) => tokens.includes(token))
          )
        })
        return {
          method: form.getAttribute('method'),
          hasPassword: !!form.querySelector('input[type="password"]'),
          personal: personal.map((field) => field.id || field.name),
          personalNamed: personal
            .filter((field) => field.getAttribute('name'))
            .map((field) => field.getAttribute('name')!),
        }
      }),
    { types: PERSONAL_TYPES, tokens: PERSONAL_AUTOCOMPLETE }
  )
}

const posts = (form: ServerForm) => form.method?.toLowerCase() === 'post'

test.use({ javaScriptEnabled: false })

test.describe('forms in the server HTML', () => {
  test.beforeEach(({ browserName }) => {
    // The server HTML is the same for every engine.
    test.skip(browserName !== 'chromium', 'Checked once, in Chromium')
  })

  test('every form with a password field posts', async ({ page }) => {
    const passwordPages: string[] = []
    for (const path of [...FORM_PAGES, ...READING_PAGES]) {
      for (const form of await serverForms(page, path)) {
        if (!form.hasPassword) continue
        passwordPages.push(path)
        expect(form.method, `${path}: form with a password field`).toMatch(
          /^post$/i
        )
      }
    }
    // Sign-in and sign-up are in the server HTML; the reset page asks for
    // the email first and draws its new-password form after.
    expect(passwordPages.sort()).toEqual(['/signin', '/signin?mode=create'])
  })

  test('every form with a named personal field posts', async ({ page }) => {
    for (const path of [...FORM_PAGES, ...READING_PAGES]) {
      for (const form of await serverForms(page, path)) {
        if (form.personalNamed.length === 0) continue
        expect(
          posts(form),
          `${path}: fields ${form.personalNamed.join(', ')} would go into the URL`
        ).toBe(true)
      }
    }
  })

  test('signed-in forms are not in the server HTML', async ({ page }) => {
    for (const path of SIGNED_IN_PAGES) {
      const personal = (await serverForms(page, path)).flatMap(
        (form) => form.personal
      )
      expect(personal, `${path}: personal fields in the server HTML`).toEqual(
        []
      )
    }
  })
})

test.describe('auth forms in the first flush', () => {
  // React streams a boundary separately, behind the loading fallback, when the
  // HTML flushed so far passes its chunk size (12,800 bytes). A browser
  // whose scripts have not run then shows only the fallback, and WebKit
  // shows nothing until they run. Each auth form must be in the first flush.
  test.use({ javaScriptEnabled: true })
  for (const path of FORM_PAGES) {
    test(`${path} shows its form before the scripts run`, async ({ page }) => {
      await page.route(/\/_next\/static\/.+\.js(\?.*)?$/, () => {})
      await page.goto(path, { waitUntil: 'domcontentloaded' })
      await expect(page.locator('form').first()).toBeVisible()
      await expect(page.getByText('Loading page…')).toHaveCount(0)
    })
  }
})

test.describe('sign-in without JavaScript', () => {
  // Signing in needs the page script (the session lives in the browser), so
  // with JavaScript off the sign-in pages say so instead of showing a form
  // that cannot work.
  for (const path of ['/signin', '/signin?mode=create', '/signin/reset'])
    test(`${path} says it needs JavaScript`, async ({ page }) => {
      await page.goto(path, { waitUntil: 'domcontentloaded' })
      await expect(page.locator('.qt-signin-page__noscript')).toContainText(
        'needs JavaScript'
      )
      await expect(page.locator('form:visible')).toHaveCount(0)
    })
})

test.describe('the inline hold blocked', () => {
  test.use({ javaScriptEnabled: true })

  // If the inline script that holds a submit does not run (here its nonce is
  // wrong, so the policy blocks it) and the page scripts are not active yet,
  // the browser submits natively. No field value may reach a URL.
  const cases = [
    {
      path: '/signin',
      fields: {
        'input[name="email"]': 'blocked@example.invalid',
        'input[name="password"]': 'Blocked-hold-1234',
      },
    },
    {
      path: '/signin?mode=create',
      fields: {
        'input[name="email"]': 'blocked@example.invalid',
        'input[name="password"]': 'Blocked-hold-1234',
      },
    },
    {
      path: '/signin/reset',
      fields: { 'input[name="email"]': 'blocked@example.invalid' },
    },
    {
      path: '/waitlist',
      fields: { '#email': 'blocked@example.invalid' },
    },
  ]
  for (const { path, fields } of cases) {
    const pathname = new URL(path, 'http://x').pathname
    test(`${path} keeps every value out of URLs`, async ({
      page,
      browserName,
    }) => {
      test.skip(browserName !== 'chromium', 'Checked once, in Chromium')
      const urls: string[] = []
      page.on('request', (request) => urls.push(request.url()))
      page.on('framenavigated', (frame) => urls.push(frame.url()))
      await page.route(/\/_next\/static\/.+\.js(\?.*)?$/, () => {})
      await page.route(
        (url) => url.pathname === pathname,
        async (route) => {
          if (route.request().method() !== 'GET') return route.continue()
          const response = await route.fetch()
          const body = (await response.text()).replace(
            /<script nonce="[^"]*">\(function\(\)\{var h="data-held-submit"/,
            '<script nonce="wrong">(function(){var h="data-held-submit"'
          )
          await route.fulfill({ response, body })
        }
      )
      await page.goto(path, { waitUntil: 'domcontentloaded' })
      for (const [selector, value] of Object.entries(fields))
        await page.locator(selector).fill(value)
      const submitted = page.waitForRequest(
        (request) =>
          request.isNavigationRequest() &&
          new URL(request.url()).pathname === pathname,
        { timeout: 5000 }
      )
      await page.locator('form button[type="submit"]').click()
      const request = await submitted
      expect(request.method()).toBe('POST')
      // The server answers the post with the page again.
      expect((await request.response())?.status()).toBeLessThan(400)
      await page.waitForLoadState('domcontentloaded').catch(() => {})
      for (const value of Object.values(fields)) {
        const forms = [
          value,
          encodeURIComponent(value),
          encodeURIComponent(value).replace(/%20/g, '+'),
        ]
        for (const url of [...urls, page.url()])
          for (const form of forms)
            expect(url, `${path}: a field value in ${url}`).not.toContain(form)
      }
    })
  }
})
