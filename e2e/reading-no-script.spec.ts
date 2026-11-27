import { expect, test } from '@playwright/test'

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

const READING = [
  {
    path: '/system/reading',
    heading: 'What my grandmother’s ledger taught me about money',
    text: 'She wrote down every coin she ever gave away.',
    links: [
      { name: 'Back to reading', href: '/' },
      { name: 'Read more articles', href: '/articles' },
    ],
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
    await expect(tab.getByText(page.text)).toBeVisible()
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
  await expect(item).toHaveAttribute('href', '/login')
  await expect(nav.getByText('Balance', { exact: true })).toBeHidden()
})
