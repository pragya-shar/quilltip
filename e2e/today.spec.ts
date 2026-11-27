import { expect, test, type Page } from '@playwright/test'

// Today (`/`) on its fixture server: the real components, rendered on the
// server and hydrated, in the real application shell. Auth and drafts are
// fakes that answer after a delay; reading places are the browser's real
// storage. The production route itself (no script, first response,
// redirects, CSP) is e2e/today-app.spec.ts.

const TITLE = 'The Lamp on Orchard Street'
const SENTENCE =
  'The lamp on Orchard Street came on every evening at a quarter past six'
const PLACE = {
  articleId: 'placefixture0001',
  href: '/noor/notes-on-a-borrowed-kitchen#s-12',
  title: 'Notes on a borrowed kitchen',
  sentence: 'Every kitchen has a drawer that is not yours to open.',
  percent: 0.46,
  updatedAt: 2,
}
const FINISHED = {
  articleId: 'donefixture0001',
  href: '/ama/a-city-that-sleeps-at-noon',
  title: 'A city that sleeps at noon',
  percent: 1,
  updatedAt: 1,
  finished: true,
}

type Seed = {
  token?: boolean
  places?: object[]
  memory?: { place: boolean; draft: boolean }
}

/** Browser storage as a returning person left it, before any page script. */
async function seed(page: Page, { token, places, memory }: Seed) {
  await page.addInitScript(
    ({ token, places, memory }) => {
      // Only the first load of the test: later loads keep what the page wrote.
      if (sessionStorage.getItem('seeded')) return
      sessionStorage.setItem('seeded', '1')
      if (token) localStorage.setItem('__convexAuthJWT_fixture', 'token')
      if (places)
        localStorage.setItem(
          'quilltip:reading-position:v2',
          JSON.stringify(places)
        )
      if (memory)
        localStorage.setItem('quilltip:today-rows:v1', JSON.stringify(memory))
    },
    { token, places, memory }
  )
}

/**
 * Records where the title is when the document is first parsed, and every
 * layout shift (where the engine reports them), from before the first paint.
 */
async function watchShifts(page: Page) {
  await page.addInitScript(() => {
    const w = window as unknown as { __shift: number; __firstTop?: number }
    w.__shift = 0
    try {
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries() as unknown as {
          value: number
          hadRecentInput: boolean
        }[])
          if (!entry.hadRecentInput) w.__shift += entry.value
      }).observe({ type: 'layout-shift', buffered: true })
    } catch {
      // WebKit reports no layout shifts; the title's position is checked.
    }
    document.addEventListener('DOMContentLoaded', () => {
      w.__firstTop = document
        .querySelector('#today-title')
        ?.getBoundingClientRect().top
    })
  })
}

const titleTop = (page: Page) =>
  page.evaluate(
    () => document.querySelector('#today-title')!.getBoundingClientRect().top
  )
const firstTop = (page: Page) =>
  page.evaluate(() => (window as unknown as { __firstTop: number }).__firstTop)
const shift = (page: Page) =>
  page.evaluate(() => (window as unknown as { __shift: number }).__shift)

const place = (page: Page) => page.getByRole('link', { name: /^Your place: / })
const draft = (page: Page) => page.getByRole('link', { name: /^Your draft: / })

test.describe('first visit, signed out', () => {
  test('opens on the article: title, byline, a sentence, Read more', async ({
    page,
  }) => {
    await page.goto('/')
    const opening = page.getByRole('article')
    await expect(
      opening.getByRole('heading', { level: 1, name: TITLE })
    ).toBeVisible()
    await expect(
      opening.getByRole('link', { name: 'Fixture Writer' })
    ).toHaveAttribute('href', '/fixture-writer')
    await expect(opening.getByText(SENTENCE)).toBeVisible()
    await expect(
      opening.getByRole('link', { name: 'Read more', exact: true })
    ).toHaveAttribute(
      'href',
      // It continues where the opening stopped: paragraph 7 of the article.
      '/fixture-writer/the-lamp-on-orchard-street#s-7-0'
    )
    await expect(
      page.getByText('Writing you can tip, down to the sentence.')
    ).toBeVisible()
    // The first line in small capitals (Prose's lead-in), and the time left
    // beside Read more.
    await expect(opening.locator('.qt-prose[data-lead-in]')).toHaveCount(1)
    await expect(opening.getByText(/^\d+ min left$/)).toBeVisible()
    // The balance item says Sign in; no rows, nothing reserved.
    await expect(
      page.getByRole('link', { name: 'Sign in' }).first()
    ).toBeVisible()
    await expect(place(page)).toHaveCount(0)
    await expect(draft(page)).toHaveCount(0)
    expect(
      await page.evaluate(() => [
        document.documentElement.hasAttribute('data-today-place'),
        document.documentElement.hasAttribute('data-today-draft'),
      ])
    ).toEqual([false, false])
  })

  test('landmarks: one main, no banner, one navigation named Main', async ({
    page,
  }) => {
    await page.goto('/')
    await expect(page.getByRole('main')).toHaveCount(1)
    await expect(page.getByRole('banner')).toHaveCount(0)
    await expect(page.getByRole('navigation')).toHaveCount(1)
    await expect(page.getByRole('navigation', { name: 'Main' })).toBeVisible()
  })

  test('nothing covers or animates the text before it is readable', async ({
    page,
  }) => {
    await page.goto('/')
    await page.waitForLoadState('load')
    const result = await page.evaluate(() => {
      const today = document.querySelector('.qt-today')!
      const h1 = document.querySelector('#today-title')!
      const box = h1.getBoundingClientRect()
      const hit = document.elementFromPoint(
        box.left + Math.min(box.width / 2, 40),
        box.top + box.height / 2
      )
      return {
        animating: document.getAnimations().filter((a) => {
          const target = (a.effect as KeyframeEffect | null)?.target
          return target instanceof Node && today.contains(target)
        }).length,
        opacity: getComputedStyle(h1).opacity,
        covered: !(hit && h1.contains(hit)),
        dialogs: document.querySelectorAll('dialog[open], [aria-modal="true"]')
          .length,
        scrollLocked: getComputedStyle(document.body).overflow === 'hidden',
      }
    })
    expect(result).toEqual({
      animating: 0,
      opacity: '1',
      covered: false,
      dialogs: 0,
      scrollLocked: false,
    })
  })

  test('More to read is a list that ends; a tap anywhere on an item opens it', async ({
    page,
  }) => {
    await page.goto('/')
    const more = page.getByRole('region', { name: 'More to read' })
    const items = more.getByRole('listitem')
    await expect(items).toHaveCount(8)
    await expect(
      page.getByText('You are up to date. New writing arrives through the day.')
    ).toBeVisible()
    const link = items.first().getByRole('link', { name: /^Read more: / })
    const href = await link.getAttribute('href')
    expect(href).toMatch(/^\/fixture-writer\/fixture-article-\d$/)
    // A real tap on the title, which the link's box covers.
    const title = items.first().getByRole('heading', { level: 3 })
    await title.scrollIntoViewIfNeeded()
    const box = (await title.boundingBox())!
    await page.touchscreen.tap(box.x + 20, box.y + box.height / 2)
    await expect(page).toHaveURL(new RegExp(`${href}$`))
  })
})

test.describe('returning, signed in', () => {
  test('both rows attach above the opening without moving it', async ({
    page,
  }) => {
    await seed(page, {
      token: true,
      places: [PLACE, FINISHED],
      memory: { place: true, draft: true },
    })
    await watchShifts(page)
    await page.goto('/?auth=signed-in&draft=some&delay=600')
    await expect(place(page)).toBeVisible()
    await expect(draft(page)).toBeVisible()
    await expect(place(page)).toHaveAttribute('href', PLACE.href)
    await expect(place(page)).toContainText('46%')
    await expect(draft(page)).toHaveAttribute(
      'href',
      '/write?id=draftfixture0001'
    )
    await expect(draft(page)).toContainText('812 words')
    expect(await titleTop(page)).toBe(await firstTop(page))
    expect(await shift(page)).toBe(0)
    // The intro gives its place to the rows before the first paint.
    await expect(
      page.getByText('Writing you can tip, down to the sentence.')
    ).toBeHidden()
    await expect(
      page.getByRole('group', { name: 'Pick up where you left off' })
    ).toBeVisible()
  })

  test('a row the last visit did not show waits for the next visit', async ({
    page,
  }) => {
    // A stored place reserves its row; the draft was never shown here.
    await seed(page, { token: true, places: [PLACE] })
    await watchShifts(page)
    await page.goto('/?auth=signed-in&draft=some&delay=400')
    await expect(place(page)).toBeVisible()
    await page.waitForTimeout(800)
    await expect(draft(page)).toHaveCount(0)
    expect(await titleTop(page)).toBe(await firstTop(page))
    expect(await shift(page)).toBe(0)

    await page.reload()
    await expect(draft(page)).toBeVisible()
    expect(await titleTop(page)).toBe(await firstTop(page))
    expect(await shift(page)).toBe(0)
  })

  test('while the session is checked the space holds and nothing moves', async ({
    page,
  }) => {
    await seed(page, {
      token: true,
      places: [PLACE],
      memory: { place: true, draft: true },
    })
    await watchShifts(page)
    await page.goto('/?auth=loading')
    await page.waitForTimeout(800)
    // Your place comes from this browser and shows at once; the draft waits
    // for the session, in a quiet fill at its final size.
    await expect(place(page)).toBeVisible()
    await expect(draft(page)).toHaveCount(0)
    const fill = await page
      .locator('.qt-today__slot[data-slot="draft"]')
      .evaluate((slot) => ({
        height: slot.getBoundingClientRect().height,
        background: getComputedStyle(slot).backgroundColor,
      }))
    expect(fill.height).toBe(48)
    expect(fill.background).not.toBe('rgba(0, 0, 0, 0)')
    expect(await titleTop(page)).toBe(await firstTop(page))
    expect(await shift(page)).toBe(0)
  })
})

test('signed out, Your place still shows from this browser; the draft space goes back', async ({
  page,
}) => {
  await seed(page, {
    token: true,
    places: [PLACE],
    memory: { place: true, draft: true },
  })
  await watchShifts(page)
  await page.goto('/?auth=signed-out&delay=200')
  await expect(place(page)).toBeVisible()
  await expect
    .poll(() =>
      page.evaluate(() => [
        document.documentElement.hasAttribute('data-today-place'),
        document.documentElement.hasAttribute('data-today-draft'),
      ])
    )
    .toEqual([true, false])
  await expect(draft(page)).toHaveCount(0)
})

test('a first visit with a stored place: the row shows at once, nothing moves', async ({
  page,
}) => {
  await seed(page, { places: [PLACE] })
  await watchShifts(page)
  await page.goto('/')
  await expect(place(page)).toBeVisible()
  expect(await titleTop(page)).toBe(await firstTop(page))
  expect(await shift(page)).toBe(0)
})

test('an empty catalogue says so and offers the one way to fill it', async ({
  page,
}) => {
  await page.goto('/?data=empty')
  await expect(page.getByText('Nothing to read yet.')).toBeVisible()
  await expect(
    page.getByRole('link', { name: 'Write the first article' })
  ).toHaveAttribute('href', '/write')
  await expect(page.getByRole('region', { name: 'More to read' })).toHaveCount(
    0
  )
})

test('a backend that does not answer still gives a page', async ({ page }) => {
  await page.goto('/?data=unreachable')
  await expect(
    page.getByRole('heading', {
      level: 1,
      name: 'Today could not be loaded right now.',
    })
  ).toBeVisible()
  await expect(page.getByRole('link', { name: 'Try again' })).toHaveAttribute(
    'href',
    '/'
  )
})

for (const width of [360, 375, 390]) {
  for (const data of ['ready', 'long']) {
    test(`no horizontal page scroll at ${width} (${data} text)`, async ({
      page,
    }) => {
      await seed(page, {
        token: true,
        places: [{ ...PLACE, title: `${PLACE.title} `.repeat(8) }],
        memory: { place: true, draft: true },
      })
      await page.setViewportSize({ width, height: 800 })
      await page.goto(`/?data=${data}&auth=signed-in&draft=some`)
      await expect(place(page)).toBeVisible()
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth - innerWidth
        )
      ).toBeLessThanOrEqual(0)
    })
  }
}

test('offline: a note over the top edge, and the text stays where it is', async ({
  page,
  context,
}) => {
  await watchShifts(page)
  await page.goto('/')
  const before = await titleTop(page)
  await context.setOffline(true)
  await expect(
    page
      .getByRole('status')
      .filter({ hasText: 'Offline. Reading still works.' })
  ).toBeVisible()
  expect(await titleTop(page)).toBe(before)
  await context.setOffline(false)
  await expect(page.getByText('Offline. Reading still works.')).toHaveCount(0)
})

test('stored text goes into the page as text, never as markup', async ({
  page,
}) => {
  const markup = '<img src=x onerror="window.__ran=1">Kitchen'
  await seed(page, {
    places: [{ ...PLACE, title: markup, sentence: markup }],
  })
  await page.goto('/')
  await expect(place(page)).toContainText(markup)
  expect(await page.locator('.qt-today__resume img').count()).toBe(0)
  expect(await page.evaluate(() => (window as { __ran?: number }).__ran)).toBe(
    undefined
  )
})
