import { test, expect } from '@playwright/test'

// Start `bun e2e/fixtures/nft/server.mjs`, then set NFT_FIXTURES=1.
// Only wallet/backend collaborators are replaced; UI and validation are real.
test.describe('NFT presentation and interaction', () => {
  test.skip(
    process.env.NFT_FIXTURES !== '1',
    'Requires the isolated NFT fixture server'
  )
  test.use({ baseURL: 'http://127.0.0.1:4174' })

  for (const width of [375, 1280]) {
    for (const key of ['nftOwnedPage', 'nftMintedPage']) {
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

  test('collection retains ownership, eligibility, stats and loading meaning', async ({
    page,
  }) => {
    await page.goto('/?state=owner')
    await expect(page.getByText('2 transfers')).toBeVisible()
    await expect(page.getByText('Rare', { exact: true })).toBeVisible()
    await page.getByRole('tab', { name: 'Stats', exact: true }).click()
    await expect(page.getByText('$25.00', { exact: true })).toBeVisible()
    await page.getByRole('tab', { name: 'Actions', exact: true }).click()
    await expect(
      page.getByRole('button', { name: 'Transfer NFT', exact: true })
    ).toBeVisible()
    await page.goto('/?state=visitor')
    await page.getByRole('tab', { name: 'Actions', exact: true }).click()
    await expect(
      page.getByRole('button', { name: 'Transfer NFT', exact: true })
    ).toHaveCount(0)
    await expect(page.getByText(/You don't own this NFT/)).toBeVisible()
    await page.goto('/?state=ineligible')
    await expect(page.getByRole('progressbar').first()).toHaveAttribute(
      'aria-valuenow',
      '25'
    )
    await page.getByRole('tab', { name: 'Actions', exact: true }).click()
    await expect(
      page.getByText('Collect $7.50 more in tips to mint as NFT')
    ).toBeVisible()
    await expect(
      page.getByRole('button', { name: 'Mint NFT', exact: true })
    ).toHaveCount(0)
    await page.goto('/?state=unminted-visitor')
    await page.getByRole('tab', { name: 'Actions', exact: true }).click()
    await expect(page.getByText(/Only the author can mint/)).toBeVisible()
    await expect(
      page.getByRole('button', { name: 'Mint NFT', exact: true })
    ).toHaveCount(0)
    await page.goto('/?state=loading')
    await expect(
      page.getByRole('status', { name: 'Loading NFT collection' })
    ).toBeVisible()
  })

  test('recipient validation, review, back, cancel and focus return', async ({
    page,
  }) => {
    await page.goto('/?state=owner')
    await page.getByRole('tab', { name: 'Actions', exact: true }).click()
    const trigger = page.getByRole('button', {
      name: 'Transfer NFT',
      exact: true,
    })
    await trigger.click()
    const input = page.getByLabel('Transfer To (Username)')
    await expect(input).toBeFocused()
    await input.fill('ab')
    await page.getByRole('button', { name: 'Review transfer' }).click()
    await expect(page.getByTestId('transfer-modal-message')).toContainText(
      'Invalid username format'
    )
    await input.fill('CODEX_QA')
    await page.getByRole('button', { name: 'Review transfer' }).click()
    await expect(page.getByTestId('transfer-modal-message')).toContainText(
      'Cannot transfer to the current owner'
    )
    await input.fill('reader_friend')
    await page.getByRole('button', { name: 'Review transfer' }).click()
    await expect(page.getByTestId('transfer-confirm-recipient')).toHaveText(
      '@reader_friend'
    )
    await page.getByRole('button', { name: 'Back', exact: true }).click()
    await expect(input).toHaveValue('reader_friend')
    await page.getByRole('button', { name: 'Cancel', exact: true }).click()
    await expect(trigger).toBeFocused()
    await trigger.click()
    await expect(input).toHaveValue('')
    await input.press('Escape')
    await expect(trigger).toBeFocused()
  })

  test('transfer pending cannot dismiss and failure allows retry', async ({
    page,
  }) => {
    await page.goto('/?state=owner&mode=busy')
    await page.getByRole('tab', { name: 'Actions', exact: true }).click()
    await page
      .getByRole('button', { name: 'Transfer NFT', exact: true })
      .click()
    await page.getByLabel('Transfer To (Username)').fill('reader_friend')
    await page.getByRole('button', { name: 'Review transfer' }).click()
    await page
      .getByRole('button', { name: 'Confirm transfer', exact: true })
      .click()
    await expect(
      page.getByRole('button', { name: 'Cancel', exact: true })
    ).toBeDisabled()
    await page.keyboard.press('Escape')
    await expect(page.getByRole('dialog')).toBeVisible()
    await expect(
      page.getByRole('button', { name: 'Close', exact: true })
    ).toHaveCount(0)
    await page.mouse.click(5, 5)
    await expect(page.getByRole('dialog')).toBeVisible()
    await page.goto('/?state=owner&mode=failure')
    await page.getByRole('tab', { name: 'Actions', exact: true }).click()
    await page
      .getByRole('button', { name: 'Transfer NFT', exact: true })
      .click()
    await page.getByLabel('Transfer To (Username)').fill('reader_friend')
    await page.getByRole('button', { name: 'Review transfer' }).click()
    await page
      .getByRole('button', { name: 'Confirm transfer', exact: true })
      .click()
    await expect(page.getByTestId('transfer-modal-message')).toContainText(
      'No account uses that username'
    )
    await expect(
      page.getByRole('button', { name: 'Confirm transfer', exact: true })
    ).toBeEnabled()
  })

  for (const mode of ['preparing', 'signing', 'confirming']) {
    test(`mint ${mode} state blocks dismissal`, async ({ page }) => {
      await page.goto(`/?state=eligible&mode=${mode}`)
      await page.getByRole('tab', { name: 'Actions', exact: true }).click()
      await page.getByRole('button', { name: 'Mint NFT', exact: true }).click()
      await page
        .getByRole('dialog')
        .getByRole('button', { name: 'Mint NFT', exact: true })
        .click()
      await expect(
        page
          .locator('[aria-busy="true"]')
          .getByText(
            mode === 'preparing' ? 'Preparing your NFT' : 'Mint in progress',
            { exact: true }
          )
      ).toBeVisible()
      if (mode !== 'preparing')
        await expect(page.locator('[aria-current="step"]')).toContainText(
          mode === 'signing' ? 'Wallet' : 'Confirmed'
        )
      const progressStatus = page.getByRole('dialog').getByRole('status')
      await expect(progressStatus).not.toHaveAttribute('aria-busy', 'true')
      await expect(progressStatus).toHaveText(
        mode === 'preparing'
          ? 'Preparing your NFT'
          : mode === 'signing'
            ? 'Wallet'
            : 'Confirmed'
      )
      await page.keyboard.press('Escape')
      await page.mouse.click(5, 5)
      await expect(page.getByRole('dialog')).toBeVisible()
      await expect(
        page.getByRole('button', { name: 'Cancel', exact: true })
      ).toBeDisabled()
      await expect(
        page.getByRole('button', { name: 'Close', exact: true })
      ).toHaveCount(0)
    })
  }

  test('mint disconnected, rejection and success feedback', async ({
    page,
  }) => {
    await page.goto('/?state=eligible&mode=disconnected')
    await page.getByRole('tab', { name: 'Actions', exact: true }).click()
    const trigger = page.getByRole('button', { name: 'Mint NFT', exact: true })
    await trigger.click()
    await expect(
      page.getByRole('button', { name: 'Connect Wallet', exact: true })
    ).toBeVisible()
    await page
      .getByRole('button', { name: 'Connect Wallet', exact: true })
      .click()
    await expect(page.getByText('✓ Wallet Connected')).toBeVisible()
    await page.getByRole('button', { name: 'Cancel', exact: true }).click()
    await expect(trigger).toBeFocused()
    await page.goto('/?state=eligible&mode=failure')
    await page.getByRole('tab', { name: 'Actions', exact: true }).click()
    await trigger.click()
    await page
      .getByRole('dialog')
      .getByRole('button', { name: 'Mint NFT', exact: true })
      .click()
    await expect(page.getByRole('alert')).toContainText(
      'Wallet approval declined'
    )
    await page.getByRole('button', { name: 'Cancel', exact: true }).click()
    await page.goto('/?state=eligible')
    await page.getByRole('tab', { name: 'Actions', exact: true }).click()
    await trigger.click()
    await page
      .getByRole('dialog')
      .getByRole('button', { name: 'Mint NFT', exact: true })
      .click()
    await expect(page.getByRole('dialog')).toHaveCount(0, { timeout: 10000 })
    await expect(
      page.getByText('NFT minted successfully!', { exact: true })
    ).toBeVisible()
  })

  test('transfer success uses the existing result and close flow', async ({
    page,
  }) => {
    await page.goto('/?state=owner')
    await page.getByRole('tab', { name: 'Actions', exact: true }).click()
    const trigger = page.getByRole('button', {
      name: 'Transfer NFT',
      exact: true,
    })
    await trigger.click()
    await page.getByLabel('Transfer To (Username)').fill('reader_friend')
    await page.getByRole('button', { name: 'Review transfer' }).click()
    await page
      .getByRole('button', { name: 'Confirm transfer', exact: true })
      .click()
    await expect(page.getByTestId('transfer-modal-message')).toContainText(
      'Transfer completed successfully!'
    )
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await expect(trigger).toBeFocused()
  })

  test('long content fits narrow layouts in entry and review', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 320, height: 640 })
    await page.goto('/?state=owner')
    await page.getByRole('tab', { name: 'Actions', exact: true }).click()
    await page
      .getByRole('button', { name: 'Transfer NFT', exact: true })
      .click()
    await page
      .getByLabel('Transfer To (Username)')
      .fill('reader_with_long_username_123')
    await page.getByRole('button', { name: 'Review transfer' }).click()
    await expect(page.getByTestId('transfer-confirm-recipient')).toBeVisible()
    expect(
      await page
        .getByRole('dialog')
        .evaluate((el) => el.scrollWidth <= el.clientWidth)
    ).toBe(true)
    await page
      .getByRole('button', { name: 'Cancel', exact: true })
      .scrollIntoViewIfNeeded()
    await expect(
      page.getByRole('button', { name: 'Cancel', exact: true })
    ).toBeInViewport()
    await page.getByRole('button', { name: 'Cancel', exact: true }).click()
    await page.goto('/?state=eligible')
    await page.getByRole('tab', { name: 'Actions', exact: true }).click()
    await page.getByRole('button', { name: 'Mint NFT', exact: true }).click()
    expect(
      await page
        .getByRole('dialog')
        .evaluate((el) => el.scrollWidth <= el.clientWidth)
    ).toBe(true)
    await page.screenshot({ path: 'test-results/nft-mint-mobile.png' })
  })
})
