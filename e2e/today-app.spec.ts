import { expect, test } from '@playwright/test'

// Today (`/`) on a production build against the fixture backend
// (scripts/perf/fixture-backend.ts), started by scripts/today/app-check.ts.
// Projects named *-no-script run with JavaScript off (D19); the others with
// it on. The fixture suite (e2e/today.spec.ts) covers the rows.

test.skip(
  !process.env.TODAY_APP_CHECK,
  'Needs a production build (bun scripts/today/app-check.ts)'
)

/** What Today must show for the fixture backend's articles. */
const TODAY = {
  path: '/',
  heading: 'The Lamp on Orchard Street',
  writer: { name: 'Fixture Writer', href: '/fixture-writer' },
  text: 'The lamp on Orchard Street came on every evening at a quarter past six',
  readMore: '/fixture-writer/the-lamp-on-orchard-street',
}

/** Old paths and where they now go (lib/routing/redirects/today.ts). */
const REDIRECTS = [
  { from: '/articles', to: '/' },
  { from: '/articles?page=2&tag=stories', to: '/' },
  { from: '/articles?q=lamp', to: '/search?q=lamp' },
  { from: '/demo/write', to: '/write' },
]

const noScript = (name: string) => name.endsWith('-no-script')

test.describe('with no script', () => {
  test.beforeEach(({}, info) => {
    test.skip(!noScript(info.project.name), 'Runs with JavaScript off')
  })

  test('the first response holds the article', async ({ request }) => {
    const response = await request.get(TODAY.path)
    expect(response.status()).toBe(200)
    const html = await response.text()
    const body = html.slice(html.indexOf('<body'))
    expect(body.indexOf(TODAY.heading), 'title in the HTML').toBeGreaterThan(-1)
    expect(body.indexOf(TODAY.text), 'text in the HTML').toBeGreaterThan(-1)
    expect(body).toContain(`href="${TODAY.readMore}"`)
    // Nothing that only a script reveals: no streamed boundary, no hidden
    // segment, no loading screen.
    expect(body).not.toContain('<template id="B:')
    expect(body).not.toContain('<div hidden id="S:')
    expect(body).not.toMatch(/aria-busy="true"/)
  })

  test('readable, with Read more as a plain link that navigates', async ({
    page,
  }) => {
    await page.goto(TODAY.path)
    const opening = page.getByRole('article')
    await expect(
      opening.getByRole('heading', { level: 1, name: TODAY.heading })
    ).toBeVisible()
    await expect(
      opening.getByRole('link', { name: TODAY.writer.name })
    ).toHaveAttribute('href', TODAY.writer.href)
    await expect(opening.getByText(TODAY.text)).toBeVisible()
    const readMore = opening.getByRole('link', {
      name: 'Read more',
      exact: true,
    })
    await expect(readMore).toHaveAttribute('href', TODAY.readMore)
    await readMore.click()
    await expect(page).toHaveURL(new RegExp(`${TODAY.readMore}$`))
  })

  test('no row space is reserved', async ({ page }) => {
    await page.goto(TODAY.path)
    expect(
      await page
        .locator('html[data-today-place], html[data-today-draft]')
        .count()
    ).toBe(0)
  })
})

test.describe('with script', () => {
  test.beforeEach(({}, info) => {
    test.skip(noScript(info.project.name), 'Runs with JavaScript on')
  })

  test('a first visit: the balance item reads Sign in, no rows', async ({
    page,
  }) => {
    await page.goto(TODAY.path)
    await expect(
      page.getByRole('link', { name: 'Sign in' }).first()
    ).toBeVisible()
    await expect(
      page.getByRole('link', { name: /^Your (place|draft): / })
    ).toHaveCount(0)
  })

  for (const { from, to } of REDIRECTS) {
    test(`${from} moves permanently to ${to}`, async ({ request, baseURL }) => {
      const response = await request.get(from, { maxRedirects: 0 })
      expect(response.status()).toBe(308)
      expect(new URL(response.headers().location!, baseURL).toString()).toBe(
        new URL(to, baseURL).toString()
      )
    })
  }

  test('loads under the CSP: every script has the nonce, nothing is blocked', async ({
    page,
  }) => {
    await page.addInitScript(() => {
      const store = window as unknown as { __csp: string[] }
      store.__csp = []
      document.addEventListener('securitypolicyviolation', (event) => {
        store.__csp.push(`${event.effectiveDirective} ${event.blockedURI}`)
      })
    })
    const response = await page.goto(TODAY.path, { waitUntil: 'load' })
    const policy = response?.headers()['content-security-policy'] ?? ''
    const scriptSrc = policy.match(/(?:^|; )script-src ([^;]+)/)?.[1] ?? ''
    const nonce = scriptSrc.match(/'nonce-([^']+)'/)?.[1]
    expect(nonce, 'script-src carries a nonce').toBeTruthy()
    expect(scriptSrc).not.toContain("'unsafe-inline'")
    const html = (await response?.text()) ?? ''
    const scripts = html.match(/<script\b[^>]*>/g) ?? []
    expect(scripts.length).toBeGreaterThan(0)
    for (const tag of scripts) expect(tag).toContain(`nonce="${nonce}"`)
    await page.waitForTimeout(1000)
    expect(
      await page.evaluate(
        () => (window as unknown as { __csp: string[] }).__csp
      )
    ).toEqual([])
  })

  for (const width of [360, 375, 390]) {
    test(`no horizontal page scroll at ${width}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 800 })
      await page.goto(TODAY.path)
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth - innerWidth
        )
      ).toBeLessThanOrEqual(0)
    })
  }

  test('nothing animates the text or covers it after load', async ({
    page,
  }) => {
    await page.goto(TODAY.path, { waitUntil: 'load' })
    const result = await page.evaluate(() => {
      const today = document.querySelector('.qt-today')!
      const h1 = document.querySelector('#today-title')!
      return {
        animating: document.getAnimations().filter((a) => {
          const target = (a.effect as KeyframeEffect | null)?.target
          return target instanceof Node && today.contains(target)
        }).length,
        opacity: getComputedStyle(h1).opacity,
        dialogs: document.querySelectorAll('dialog[open], [aria-modal="true"]')
          .length,
      }
    })
    expect(result).toEqual({ animating: 0, opacity: '1', dialogs: 0 })
  })
})

/** Sets the stand-in backend's delay (scripts/today/slow-backend.ts). */
async function backendDelay(ms: number) {
  await fetch(`${process.env.TODAY_BACKEND_URL}/__delay?ms=${ms}`, {
    method: 'POST',
  })
}

// D21: a public page never waits without a limit. A skip-list cookie that
// no other test sends gives each request its own cache entry, so the read
// really goes to the backend.
test.describe('a slow backend', () => {
  test.describe.configure({ mode: 'serial' })
  test.afterEach(() => backendDelay(0))

  test('with a fast read, the opening renders', async ({ request }, info) => {
    const response = await request.get(TODAY.path, {
      headers: {
        cookie: `qt_finished=fast${info.project.name.length}${Date.now()}`,
      },
    })
    expect(response.status()).toBe(200)
    expect(await response.text()).toContain(TODAY.text)
  })

  test('past the limit, / answers within the bound with the unreachable state', async ({
    page,
    request,
  }, info) => {
    await backendDelay(5000)
    const cookie = `qt_finished=slow${info.project.name.length}${Date.now()}`
    const started = Date.now()
    const response = await request.get(TODAY.path, { headers: { cookie } })
    const elapsed = Date.now() - started
    // The 1.5 s limit plus the render, with room for a busy CI runner.
    expect(elapsed).toBeLessThan(3500)
    expect(response.status()).toBe(200)
    const html = await response.text()
    expect(html).toContain('Today’s article did not load.')
    expect(html).not.toContain(TODAY.text)
    expect(html).toMatch(/<meta name="robots" content="noindex"/)
    expect(response.headers()['cache-control']).toContain('no-store')

    if (!noScript(info.project.name)) return
    // With no script: a plain message and a plain Try again link.
    await page.context().addCookies([
      {
        name: 'qt_finished',
        value: `slowpage${Date.now()}`,
        url: info.project.use.baseURL!,
      },
    ])
    await page.goto(TODAY.path)
    await expect(page.getByText('Today’s article did not load.')).toBeVisible()
    await expect(page.getByRole('link', { name: 'Try again' })).toHaveAttribute(
      'href',
      '/'
    )
  })
})
