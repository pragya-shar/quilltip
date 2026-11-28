import { readFileSync } from 'node:fs'
import path from 'node:path'
import { expect, test, type Page } from '@playwright/test'
import {
  OTHER_CONVEX_IMAGE,
  OWN_IMAGE,
  OWN_ORIGIN,
  UNSPLASH_IMAGE,
} from './fixtures/article-images/article'
import {
  imageSourceRefusal,
  isAllowedImageSource,
} from '../lib/security/imageSources'

/**
 * Article images load only from this deployment's file storage and the
 * listed hosts (#615). One article holds an own-storage image, an Unsplash
 * image and an image from another Convex deployment: the first two render
 * and the third does not, in the server HTML before scripts and in every
 * reader after scripts load. The page carries the app's own policy header.
 *
 * The renderer check is the control and the policy header the second layer,
 * so each is shown alone: with no header (a response that did not pass the
 * proxy) the renderers emit nothing for the outside host, and with the
 * renderer check switched off the header alone blocks the load. A control
 * run with both off shows the outside image does load, so the checks can see
 * a load.
 *
 *   bun run test:e2e:fixtures --suite article-images
 *
 * or by hand:
 *
 *   bun e2e/fixtures/article-images/server.mjs
 *   ARTICLE_IMAGES_FIXTURES=1 QUILLTIP_E2E_FIXTURES=1 bunx playwright test --config e2e/fixtures/article-images/playwright.config.ts
 */
test.skip(
  process.env.ARTICLE_IMAGES_FIXTURES !== '1',
  'Runs against the article image fixture server'
)

const jpeg = readFileSync(
  path.join(__dirname, '../public/images/quilltip-cover.jpg')
)

/** Serves the outside hosts locally and records any request to the other one. */
async function watch(page: Page) {
  const otherRequests: string[] = []
  const policyErrors: string[] = []
  await page.route('https://images.unsplash.com/**', (route) =>
    route.fulfill({ body: jpeg, contentType: 'image/jpeg' })
  )
  await page.route('https://someone-else-456.convex.cloud/**', (route) => {
    otherRequests.push(route.request().url())
    return route.fulfill({ body: jpeg, contentType: 'image/jpeg' })
  })
  await page.addInitScript(() => {
    const store = window as unknown as { __violations: string[] }
    store.__violations = []
    document.addEventListener('securitypolicyviolation', (event) => {
      store.__violations.push(`${event.effectiveDirective} ${event.blockedURI}`)
    })
  })
  page.on('console', (message) => {
    if (
      message.type() === 'error' &&
      /Content Security Policy/i.test(message.text())
    )
      policyErrors.push(message.text())
  })
  return { otherRequests, policyErrors }
}

/** The images of one reader, each scrolled into view until it has loaded. */
async function shownImages(page: Page, reader: string) {
  const images = page.locator(`[data-reader="${reader}"] img`)
  const sources: (string | null)[] = []
  for (let i = 0; i < (await images.count()); i += 1) {
    const image = images.nth(i)
    await image.scrollIntoViewIfNeeded()
    await expect
      .poll(() =>
        image.evaluate(
          (img: HTMLImageElement) => img.complete && img.naturalWidth > 0
        )
      )
      .toBe(true)
    sources.push(await image.getAttribute('src'))
  }
  return sources
}

async function noSideScroll(page: Page) {
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth
    )
  ).toBe(true)
}

for (const width of [375, 1440]) {
  test.describe(`at ${width} px`, () => {
    test.use({ viewport: { width, height: 900 } })

    test('the server HTML shows the own-storage and Unsplash images and not the other', async ({
      page,
    }) => {
      const seen = await watch(page)
      await page.goto('/?js=0')
      expect(await shownImages(page, 'server')).toEqual([
        OWN_IMAGE,
        UNSPLASH_IMAGE,
      ])
      // The refused image leaves an empty hidden block: nothing to see.
      const hidden = page.locator(
        '[data-reader="server"] [data-article-image-hidden]'
      )
      await expect(hidden).toHaveCount(1)
      await expect(hidden).toBeHidden()
      await expect(page.locator('[data-reader="server"]')).toContainText(
        'After the images.'
      )
      await noSideScroll(page)
      expect(seen.otherRequests).toEqual([])
      expect(seen.policyErrors).toEqual([])
    })

    test('after scripts load, every reader shows the same two images and not the other', async ({
      page,
    }) => {
      const seen = await watch(page)
      await page.goto('/')
      for (const reader of ['client', 'highlight', 'writer']) {
        await expect(
          page.locator(`[data-reader="${reader}"] img`),
          reader
        ).toHaveCount(2)
      }
      for (const reader of ['server', 'client', 'highlight', 'writer']) {
        expect(await shownImages(page, reader), reader).toEqual([
          OWN_IMAGE,
          UNSPLASH_IMAGE,
        ])
      }
      await expect(
        page.locator('[data-reader="highlight"] [data-article-image-hidden]')
      ).toBeHidden()
      // The writer sees why an image is missing, in its place.
      await expect(page.locator('[data-reader="writer"]')).toContainText(
        'This image is not shown. Images must be uploaded or come from an allowed host.'
      )
      await noSideScroll(page)
      expect(seen.otherRequests).toEqual([])
      expect(seen.policyErrors).toEqual([])
    })

    test('without the policy header, no renderer emits the outside image', async ({
      page,
    }) => {
      const seen = await watch(page)
      // The server HTML, as sent: every src in it is on the allowlist.
      const raw = await page.request.get('/?js=0&csp=0')
      expect(raw.headers()['content-security-policy']).toBeUndefined()
      const sources = [...(await raw.text()).matchAll(/\ssrc="([^"]*)"/g)].map(
        (match) => match[1]!.replaceAll('&amp;', '&')
      )
      expect(sources).toEqual([OWN_IMAGE, UNSPLASH_IMAGE])
      expect(
        sources.filter((src) => !isAllowedImageSource(src, OWN_ORIGIN))
      ).toEqual([])
      // Every reader after scripts load, still without the header.
      const response = await page.goto('/?csp=0')
      expect(response?.headers()['content-security-policy']).toBeUndefined()
      for (const reader of ['client', 'highlight', 'writer']) {
        await expect(
          page.locator(`[data-reader="${reader}"] img`),
          reader
        ).toHaveCount(2)
      }
      for (const reader of ['server', 'client', 'highlight', 'writer']) {
        await expect(
          page.locator(`[data-reader="${reader}"] [src*="someone-else-456"]`),
          reader
        ).toHaveCount(0)
        expect(await shownImages(page, reader), reader).toEqual([
          OWN_IMAGE,
          UNSPLASH_IMAGE,
        ])
      }
      expect(seen.otherRequests).toEqual([])
    })

    test('with the renderer check off, the policy header alone blocks the outside image', async ({
      page,
    }) => {
      const seen = await watch(page)
      const response = await page.goto('/?renderer=off')
      expect(response?.headers()['content-security-policy']).toContain(
        'img-src'
      )
      for (const reader of ['server', 'client', 'highlight', 'writer']) {
        // The renderer emits the outside image: only the header stands.
        const outside = page.locator(
          `[data-reader="${reader}"] img[src="${OTHER_CONVEX_IMAGE}"]`
        )
        await expect(outside, reader).toHaveCount(1)
        await outside.scrollIntoViewIfNeeded()
        await expect
          .poll(
            () =>
              outside.evaluate(
                (img: HTMLImageElement) =>
                  img.complete && img.naturalWidth === 0
              ),
            { message: reader }
          )
          .toBe(true)
      }
      await expect
        .poll(() =>
          page.evaluate(
            () => (window as unknown as { __violations: string[] }).__violations
          )
        )
        .toContain(`img-src ${OTHER_CONVEX_IMAGE}`)
      expect(seen.otherRequests).toEqual([])
    })

    test('control: with both layers off, the outside image loads', async ({
      page,
    }) => {
      const seen = await watch(page)
      await page.goto('/?renderer=off&csp=0&js=0')
      const outside = page.locator(
        `[data-reader="server"] img[src="${OTHER_CONVEX_IMAGE}"]`
      )
      await outside.scrollIntoViewIfNeeded()
      await expect
        .poll(() =>
          outside.evaluate(
            (img: HTMLImageElement) => img.complete && img.naturalWidth > 0
          )
        )
        .toBe(true)
      expect(seen.otherRequests).toEqual([OTHER_CONVEX_IMAGE])
    })

    test('the image dialog refuses an outside address and names what is allowed', async ({
      page,
    }) => {
      await watch(page)
      await page.goto('/')
      await page.getByRole('button', { name: 'Add an image' }).click()
      const address = page.getByLabel('Or use an image address')
      await address.fill(OTHER_CONVEX_IMAGE)
      await page.getByRole('button', { name: 'Add image from address' }).click()
      await expect(page.getByRole('alert')).toHaveText(
        imageSourceRefusal(OTHER_CONVEX_IMAGE)
      )
      await expect(page.getByRole('alert')).toContainText(
        'Images must be uploaded, or come from img.youtube.com, images.unsplash.com, plus.unsplash.com or arweave.net.'
      )
      // A listed host is accepted.
      await address.fill(UNSPLASH_IMAGE)
      await page.getByRole('button', { name: 'Add image from address' }).click()
      await expect(page.locator('[data-reader="writer"] img')).toHaveCount(3)
    })
  })
}
