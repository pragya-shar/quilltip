import { test, expect } from '@playwright/test'

// Start `bun e2e/fixtures/nft/server.mjs`, then set NFT_FIXTURES=1.
// Only the Convex queries are replaced; the profile components are real.
test.describe('Profile NFT collections', () => {
  test.skip(
    process.env.NFT_FIXTURES !== '1',
    'Requires the isolated NFT fixture server'
  )
  test.use({ baseURL: 'http://127.0.0.1:4174' })

  for (const width of [375, 1280]) {
    for (const key of ['nftOwnedPage', 'nftMintedPage']) {
      test(`cached ${key} cards and ranges stay aligned through client pagination at ${width}px`, async ({
        page,
      }) => {
        await page.setViewportSize({ width, height: 844 })
        const collectionName =
          key === 'nftOwnedPage' ? 'Owned NFTs' : 'Minted NFTs'
        const kind = key === 'nftOwnedPage' ? 'owned' : 'minted'
        const otherKey =
          key === 'nftOwnedPage' ? 'nftMintedPage' : 'nftOwnedPage'
        const collection = page.getByRole('region', {
          name: collectionName,
          exact: true,
        })
        const other = page.getByRole('region', {
          name: key === 'nftOwnedPage' ? 'Minted NFTs' : 'Owned NFTs',
          exact: true,
        })
        const errors: string[] = []
        page.on('pageerror', (error) => errors.push(error.message))
        page.on('console', (message) => {
          if (message.type() === 'error') errors.push(message.text())
        })
        page.on('requestfailed', (request) => errors.push(request.url()))
        await page.goto(
          `/writer?state=profile-pagination&controlled=1&tab=nfts&${otherKey}=2&tag=art&total=19`
        )
        // These markers disappear on a document reload or profile-tab remount.
        await collection.evaluate((element) =>
          element.setAttribute('data-retained', 'yes')
        )
        await other.evaluate((element) =>
          element.setAttribute('data-retained', 'yes')
        )
        const titles = (start: number, count: number) =>
          Array.from(
            { length: count },
            (_, index) => `Article ${start + index}`
          )
        const expectPage = async (
          start: number,
          count: number,
          total: number
        ) => {
          await expect(
            collection.getByRole('heading', { level: 3 })
          ).toHaveText(titles(start, count))
          await expect(
            collection.getByText(
              `Showing ${start} – ${start + count - 1} of ${total} NFTs`,
              { exact: true }
            )
          ).toBeVisible()
        }
        const expectIndependent = async (requestedPage: number) => {
          const url = new URL(page.url())
          expect(url.searchParams.get(key)).toBe(
            requestedPage === 1 ? null : String(requestedPage)
          )
          expect(url.searchParams.get(otherKey)).toBe('2')
          expect(url.searchParams.get('tab')).toBe('nfts')
          expect(url.searchParams.get('tag')).toBe('art')
          await expect(collection).toHaveAttribute('data-retained', 'yes')
          await expect(other).toHaveAttribute('data-retained', 'yes')
          await expect(other.getByRole('heading', { level: 3 })).toHaveText(
            titles(10, 9)
          )
          await expect(
            other.getByText('Showing 10 – 18 of 19 NFTs', { exact: true })
          ).toBeVisible()
          await expect(other.locator('[aria-busy]')).toHaveAttribute(
            'aria-busy',
            'false'
          )
        }

        await expectPage(1, 9, 19)
        await collection
          .getByRole('link', { name: 'Next page', exact: true })
          .press('Enter')
        await expect(collection.locator('[aria-busy]')).toHaveAttribute(
          'aria-busy',
          'true'
        )
        await expectPage(1, 9, 19)
        await expectIndependent(2)
        await page
          .getByRole('button', { name: `Resolve ${kind} page`, exact: true })
          .click()
        await expect(collection.locator('[aria-busy]')).toHaveAttribute(
          'aria-busy',
          'false'
        )
        await expectPage(10, 9, 19)
        await expectIndependent(2)

        await collection
          .getByRole('link', { name: 'Next page', exact: true })
          .click()
        await expect(collection.locator('[aria-busy]')).toHaveAttribute(
          'aria-busy',
          'true'
        )
        await expectPage(10, 9, 19)
        await expectIndependent(3)
        await page
          .getByRole('button', {
            name: `Resolve ${kind} empty page`,
            exact: true,
          })
          .click()
        await expect(collection.locator('[aria-busy]')).toHaveAttribute(
          'aria-busy',
          'false'
        )
        await expect(collection.getByRole('article')).toHaveCount(0)
        await expect(collection.getByText(/Showing/)).toHaveCount(0)
        const recovery = collection.getByRole('link', {
          name: 'Go to last available page',
        })
        await expect(recovery).toBeVisible()
        await expectIndependent(3)
        await recovery.press('Enter')
        await expect(collection.locator('[aria-busy]')).toHaveAttribute(
          'aria-busy',
          'true'
        )
        await expectIndependent(1)
        await page
          .getByRole('button', { name: `Resolve ${kind} page`, exact: true })
          .click()
        await expectPage(1, 9, 9)
        await expectIndependent(1)
        await page.getByRole('button', { name: 'Toggle theme' }).click()
        expect(
          await page.evaluate(() => document.documentElement.scrollWidth)
        ).toBeLessThanOrEqual(width)
        expect(errors).toEqual([])
      })

      test(`stale ${key} recovers independently at ${width}px`, async ({
        page,
      }) => {
        await page.setViewportSize({ width, height: 844 })
        const otherKey =
          key === 'nftOwnedPage' ? 'nftMintedPage' : 'nftOwnedPage'
        const collection = page.getByRole('region', {
          name: key === 'nftOwnedPage' ? 'Owned NFTs' : 'Minted NFTs',
          exact: true,
        })
        await page.goto(
          `/writer?state=profile-pagination&tab=nfts&${key}=2&${otherKey}=3&tag=art&total=9`
        )
        await expect(collection).toBeVisible()
        await expect(collection.getByText(/Showing/)).toHaveCount(0)
        const recovery = collection.getByRole('link', {
          name: 'Go to last available page',
        })
        await expect(recovery).toBeVisible()
        const href = await recovery.getAttribute('href')
        const recovered = new URL(href!, 'http://127.0.0.1:4174')
        expect(recovered.searchParams.has(key)).toBe(false)
        expect(recovered.searchParams.get(otherKey)).toBe('3')
        expect(recovered.searchParams.get('tab')).toBe('nfts')
        expect(recovered.searchParams.get('tag')).toBe('art')
        await recovery.focus()
        await expect(recovery).toBeFocused()
        await recovery.press('Enter')
        await expect(
          collection.getByText('Showing 1 – 9 of 9 NFTs', { exact: true })
        ).toBeVisible()
        await expect(collection.getByRole('article')).toHaveCount(9)
        await page.goto(
          `/writer?state=profile-pagination&tab=nfts&${key}=4&${otherKey}=2&tag=art&total=19`
        )
        await expect(collection.getByText(/Showing/)).toHaveCount(0)
        await expect(recovery).toHaveAttribute(
          'href',
          `/writer?state=profile-pagination&tab=nfts&${key}=3&${otherKey}=2&tag=art&total=19`
        )
        await recovery.click()
        await expect(
          collection.getByText('Showing 19 – 19 of 19 NFTs', { exact: true })
        ).toBeVisible()
      })
    }

    test(`NFT pages remain accurate when collections shrink at ${width}px`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 844 })
      await page.goto('/writer?state=profile-pagination&tab=nfts&total=10')
      await expect(
        page.getByText('Showing 1 – 9 of 10 NFTs', { exact: true })
      ).toHaveCount(2)
      await page.goto(
        '/writer?state=profile-pagination&tab=nfts&total=10&nftOwnedPage=2&nftMintedPage=2'
      )
      await expect(
        page.getByText('Showing 10 – 10 of 10 NFTs', { exact: true })
      ).toHaveCount(2)
      await page
        .getByRole('button', { name: 'Shrink collections to 9' })
        .click()
      await expect(page.getByText(/Showing/)).toHaveCount(0)
      await expect(
        page.getByRole('link', { name: 'Go to last available page' })
      ).toHaveCount(2)
      await page.getByRole('button', { name: 'Toggle theme' }).click()
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth)
      ).toBeLessThanOrEqual(width)
      await page
        .getByRole('region', { name: 'Owned NFTs', exact: true })
        .getByRole('link', { name: 'Go to last available page' })
        .click()
      await expect(
        page.getByText('Showing 1 – 9 of 9 NFTs', { exact: true })
      ).toBeVisible()
      await page.goto(
        '/writer?state=profile-pagination&total=0&nftOwnedPage=2&nftMintedPage=2'
      )
      await expect(
        page.getByRole('heading', { name: 'A collection to come' })
      ).toBeVisible()
      await expect(page.getByText(/Showing/)).toHaveCount(0)
      await page.goto('/writer?state=profile-pagination&loading=1')
      await expect(
        page.getByRole('status', {
          name: 'Loading NFT collections',
          exact: true,
        })
      ).toBeVisible()
      await expect(page.getByText(/Showing/)).toHaveCount(0)
    })

    test(`profile pagination and NFT counts retain contrast at ${width}px`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 844 })
      await page.goto('/?state=profile')
      const articles = page.getByRole('region', {
        name: 'Articles',
        exact: true,
      })
      const nfts = page.getByRole('region', { name: 'Owned NFTs', exact: true })
      for (const theme of ['light', 'dark']) {
        if (theme === 'dark')
          await page.getByRole('button', { name: 'Toggle theme' }).click()
        const labels =
          width === 375
            ? page.getByText('Page 1 of 8', { exact: true })
            : page.getByText('More pages', { exact: true }).locator('..')
        await expect(labels).toHaveCount(2)
        for (const label of await labels.all()) {
          await expect(label).toBeVisible()
          // Contrast is measured against the fixed paper, including dark ellipsis opacity.
          const contrast = await label.evaluate((element) => {
            const color = getComputedStyle(element).color
            const canvas = document.createElement('canvas')
            const context = canvas.getContext('2d')!
            context.fillStyle = '#faf5ec'
            context.fillRect(0, 0, 1, 1)
            context.fillStyle = color
            context.fillRect(0, 0, 1, 1)
            const channels = [...context.getImageData(0, 0, 1, 1).data].slice(
              0,
              3
            )
            const luminance = (rgb: number[]) =>
              rgb.reduce((sum, value, i) => {
                const s = value / 255
                return (
                  sum +
                  (s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4) *
                    [0.2126, 0.7152, 0.0722][i]!
                )
              }, 0)
            return (
              (luminance([250, 245, 236]) + 0.05) / (luminance(channels) + 0.05)
            )
          })
          expect(contrast).toBeGreaterThanOrEqual(4.5)
        }
        await expect(nfts.getByText('72 NFTs', { exact: true })).toHaveCSS(
          'color',
          'rgb(94, 83, 90)'
        )
        await expect(
          nfts.getByText('Showing 1 – 9 of 72 NFTs', { exact: true })
        ).toHaveCSS('color', 'rgb(94, 83, 90)')
        await expect(
          articles.getByRole('link', { name: 'Next page' })
        ).toHaveAttribute('href', '/writer?page=2')
        await expect(
          nfts.getByRole('link', { name: 'Next page' })
        ).toHaveAttribute('href', '/writer?tab=nfts&nftOwnedPage=2')
        expect(
          await page.evaluate(() => document.documentElement.scrollWidth)
        ).toBeLessThanOrEqual(width)
      }
    })
  }
})
