import { test, expect } from '@playwright/test'

const DEV_CONSOLE_PATTERN = /development|dev mode|devtools|development build/i

const PUBLIC_PAGES = [
  { name: 'home', path: '/' },
  { name: 'articles', path: '/articles' },
  { name: 'guide', path: '/guide' },
] as const

function collectDevConsoleMessages(
  entries: { type: string; text: string }[]
): { type: string; text: string }[] {
  return entries.filter((e) => DEV_CONSOLE_PATTERN.test(e.text))
}

async function captureConsoleForPath(
  page: import('@playwright/test').Page,
  path: string
) {
  const entries: { type: string; text: string }[] = []
  page.on('console', (msg) => {
    entries.push({ type: msg.type(), text: msg.text() })
  })
  await page.goto(path, { waitUntil: 'networkidle', timeout: 60_000 })
  await page.waitForTimeout(2000)
  return entries
}

test.describe('ENG-224 public pages console', () => {
  test.setTimeout(120_000)

  for (const pageDef of PUBLIC_PAGES) {
    test(`${pageDef.name} has no development-mode console messages`, async ({
      page,
    }) => {
      const entries = await captureConsoleForPath(page, pageDef.path)
      const devMatches = collectDevConsoleMessages(entries)
      expect(
        devMatches,
        devMatches.map((m) => `[${m.type}] ${m.text}`).join('\n')
      ).toEqual([])
    })
  }

  test('article detail has no development-mode console messages', async ({
    page,
  }) => {
    await page.goto('/articles', {
      waitUntil: 'networkidle',
      timeout: 60_000,
    })
    const articleLink = page
      .locator('a[href^="/"]')
      .filter({ has: page.locator('article, [data-article], h2, h3') })
      .first()
    const href = await articleLink.getAttribute('href').catch(() => null)

    const fallbackLink = page.locator('main a[href*="/"]').nth(1)
    const resolvedHref =
      href &&
      href.startsWith('/') &&
      href.split('/').filter(Boolean).length >= 2
        ? href
        : await fallbackLink.getAttribute('href').catch(() => null)

    test.skip(
      !resolvedHref ||
        !resolvedHref.startsWith('/') ||
        resolvedHref.split('/').filter(Boolean).length < 2,
      'No published article link on /articles to test article detail'
    )

    const entries = await captureConsoleForPath(page, resolvedHref!)
    const devMatches = collectDevConsoleMessages(entries)
    expect(
      devMatches,
      devMatches.map((m) => `[${m.type}] ${m.text}`).join('\n')
    ).toEqual([])
  })
})
