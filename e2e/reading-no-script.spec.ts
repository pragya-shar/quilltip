import { expect, test } from '@playwright/test'

// Public reading in the application shell works with no script (D19): the
// article is in the first response, visible, with plain links. Runs against
// a production build (scripts/system/no-script-check.ts) with JavaScript
// turned off, in Chromium and WebKit. Add each public route of the shell
// here as it lands; the gallery is exempt.

test.skip(
  !process.env.NO_SCRIPT_CHECK,
  'Needs a production build (bun scripts/system/no-script-check.ts)'
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
  {
    // Today, on the fixture backend's articles (scripts/perf/convex-fixture.ts).
    path: '/',
    heading: 'The Lamp on Orchard Street',
    text: 'The lamp on Orchard Street came on every evening at a quarter past six',
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
    await expect(tab.getByText(page.text)).toBeVisible()
    for (const link of page.links) {
      const el = tab.getByRole('link', { name: link.name })
      await expect(el).toBeVisible()
      await expect(el).toHaveAttribute('href', link.href)
    }
  })
}
