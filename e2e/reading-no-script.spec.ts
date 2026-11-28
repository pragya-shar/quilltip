import { expect, test } from '@playwright/test'
import { signInPathFromRoutes } from '../lib/routing/signInPath'

// Public reading in the application shell works with no script: the
// article is in the first response, visible, with plain links. Runs against
// a production build (scripts/app-checks/run.ts) with JavaScript
// turned off, in Chromium and WebKit. The foundation's public routes; a
// surface checks its own in its production-build check and lists the route
// in `noScript` (scripts/perf/routes/<package>.ts).

test.skip(
  !process.env.NO_SCRIPT_CHECK,
  'Needs a production build (bun scripts/app-checks/run.ts)'
)

const READING: {
  path: string
  heading: string
  text: string
  /** Where the text is: the fixture's articles share their first lines,
   * so on Today the opening article holds it, not the list under it. */
  within?: string
  links: { name: string; href: string }[]
}[] = [
  {
    path: '/system/reading',
    heading: 'What my grandmother’s ledger taught me about money',
    text: 'She wrote down every coin she ever gave away.',
    links: [
      { name: 'Back to reading', href: '/' },
      { name: 'Read more articles', href: '/articles' },
    ],
  },
  {
    // Today, on the fixture backend's articles (scripts/perf/convex-fixture.ts).
    path: '/',
    heading: 'The Lamp on Orchard Street',
    text: 'The lamp on Orchard Street came on every evening at a quarter past six',
    within: 'article[aria-labelledby="today-title"]',
    links: [{ name: 'Fixture Writer', href: '/fixture-writer' }],
  },
]

for (const page of READING) {
  test(`${page.path}: the first response holds the article`, async ({
    request,
  }) => {
    const response = await request.get(page.path)
    expect(response.status()).toBe(200)
    const html = await response.text()
    const body = html.slice(html.indexOf('<body'))
    const at = body.indexOf(page.text)
    expect(at, 'article text in the HTML').toBeGreaterThan(-1)
    // No streamed boundary that only a script reveals: no fallback
    // template, no hidden segment.
    expect(body).not.toContain('<template id="B:')
    expect(body).not.toContain('<div hidden id="S:')
  })

  test(`${page.path}: readable and navigable with no script`, async ({
    page: tab,
  }) => {
    await tab.goto(page.path)
    await expect(
      tab.getByRole('heading', { level: 1, name: page.heading })
    ).toBeVisible()
    const where = page.within ? tab.locator(page.within) : tab.locator('body')
    await expect(where.getByText(page.text)).toBeVisible()
    for (const link of page.links) {
      const el = tab.getByRole('link', { name: link.name })
      await expect(el).toBeVisible()
      await expect(el).toHaveAttribute('href', link.href)
    }
  })
}

test('/system/unreachable: a late read answers with the unreachable state', async ({
  page,
  request,
}) => {
  const response = await request.get('/system/unreachable?line=3')
  expect(response.status()).toBe(200)
  const html = await response.text()
  expect(html).toContain('could not be loaded right now.')
  expect(html).toMatch(/<meta name="robots" content="noindex/)
  await page.goto('/system/unreachable?line=3')
  await expect(
    page.getByRole('heading', {
      level: 1,
      name: 'This article could not be loaded right now.',
    })
  ).toBeVisible()
  await expect(page.getByRole('link', { name: 'Try again' })).toHaveAttribute(
    'href',
    '/system/unreachable?line=3'
  )
})

test('/shelf: with no script, the balance item is a link to sign in', async ({
  page,
}) => {
  await page.goto('/shelf')
  const nav = page.getByRole('navigation', { name: 'Main' })
  const item = nav.getByRole('link', { name: 'Sign in' })
  await expect(item).toBeVisible()
  await expect(item).toHaveAttribute('href', signInPathFromRoutes())
  await expect(nav.getByText('Balance', { exact: true })).toBeHidden()
})

test('an indexable page that cannot read still asks not to be indexed', async ({
  request,
}) => {
  // The page's own metadata says index; the unreachable state says noindex.
  const response = await request.get('/system/unreachable?indexable=1')
  expect(response.status()).toBe(200)
  const html = await response.text()
  expect(html).toContain('could not be loaded right now.')
  expect(html).toMatch(/<meta name="robots" content="index, follow"/)
  expect(html).toMatch(/<meta name="robots" content="noindex"/)
})

test('/shelf: the bar is plain links with no script', async ({ page }) => {
  await page.goto('/shelf')
  const nav = page.getByRole('navigation', { name: 'Main' })
  for (const [name, href] of [
    ['Today', '/'],
    ['Shelf', '/shelf'],
    ['Write', '/write'],
    ['Sign in', signInPathFromRoutes()],
  ] as const)
    await expect(nav.getByRole('link', { name })).toHaveAttribute('href', href)
})

// A pushed screen hides the phone bar; its way back is a plain link.
for (const [path, back] of [
  ['/system/reading', 'Back to reading'],
  ['/pocket', 'Back to Today'],
] as const) {
  test(`${path}: the way back is a plain link with no script`, async ({
    page,
  }) => {
    await page.goto(path)
    await expect(page.getByRole('link', { name: back })).toHaveAttribute(
      'href',
      '/'
    )
  })
}

test('/pocket: with no script, the page asks to sign in, with no waiting figure', async ({
  page,
}) => {
  await page.goto('/pocket')
  await expect(
    page.getByRole('heading', { level: 1, name: 'Balance' })
  ).toBeVisible()
  const main = page.getByRole('main')
  await expect(
    main.getByText('Sign in to tip and keep your lines.')
  ).toBeVisible()
  // A plain link to sign in that comes back here.
  await expect(main.getByRole('link', { name: 'Sign in' })).toHaveAttribute(
    'href',
    `${signInPathFromRoutes()}?returnTo=%2Fpocket`
  )
  // The live balance's waiting figure is in the page, and hidden.
  await expect(main.locator('[aria-busy="true"]:visible')).toHaveCount(0)
})
