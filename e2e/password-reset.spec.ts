import { expect, test } from '@playwright/test'

import {
  POINTERS,
  animationsSettled,
  cancelledPress,
  expectClicked,
  expectNotClicked,
  markClick,
  penUnsupported,
  pressWith,
} from './helpers/press'

// Runs without an account or email delivery. With no AUTH_RESEND_KEY on the
// backend, the request step must say that no code was sent. Set
// PLAYWRIGHT_RESET_EMAIL_CONFIGURED=1 when the backend can send email.
// CI runs it in the Early Taps job (scripts/perf/early-taps-check.ts),
// against the fixture backend, which answers no actions: the request step's
// test skips there.

for (const viewport of [
  { width: 1440, height: 1000 },
  { width: 390, height: 844 },
]) {
  test.describe(`Password reset at ${viewport.width}px`, () => {
    test.use({ viewport })

    test('log in links to the request step and carries the typed email', async ({
      page,
    }) => {
      await page.goto('/login')
      await page
        .getByLabel('Email', { exact: true })
        .fill('reader@example.test')
      await page.getByRole('link', { name: 'Forgot password?' }).click()
      await expect(page).toHaveURL(/\/forgot-password$/)
      await expect(
        page.getByRole('heading', { level: 1, name: 'Reset your password.' })
      ).toBeVisible()
      await expect(page.getByLabel('Email', { exact: true })).toHaveValue(
        'reader@example.test'
      )
    })

    test('request step validates and reports the outcome honestly', async ({
      page,
    }) => {
      test.skip(
        process.env.QUILLTIP_FIXTURE_BACKEND === '1',
        'The fixture backend answers queries only, not the reset request.'
      )
      await page.goto('/forgot-password')
      const email = page.getByLabel('Email', { exact: true })
      await page.getByRole('button', { name: 'Send reset code' }).click()
      await expect(page.getByText('Enter your email address.')).toBeVisible()
      await expect(email).toBeFocused()

      await email.fill('nobody@example.test')
      await page.getByRole('button', { name: 'Send reset code' }).click()
      if (process.env.PLAYWRIGHT_RESET_EMAIL_CONFIGURED) {
        await expect(
          page.getByRole('heading', { name: 'Check your email' })
        ).toBeFocused()
        await expect(page.getByRole('status')).toContainText(
          'If an account uses nobody@example.test'
        )
      } else {
        // Scoped to the form: Next.js also renders a route announcer with
        // role="alert" on every page.
        await expect(
          page
            .getByRole('region', { name: 'Reset your password.' })
            .getByRole('alert')
        ).toContainText('no code was sent')
        await expect(
          page.getByRole('link', { name: 'Contact Quilltip' })
        ).toBeVisible()
      }
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth
        )
      ).toBe(true)
    })

    // The email field checks itself as it loses focus, which a press on
    // Send reset code causes. Room is kept for its error, so the button
    // stays where the press started for every pointer (#658).
    for (const pointer of POINTERS) {
      test.describe(`${pointer} press`, () => {
        if (pointer === 'touch') test.use({ hasTouch: true })

        test(`with an invalid email, a ${pointer} press on Send reset code reaches it`, async ({
          page,
          browserName,
        }) => {
          test.skip(
            penUnsupported(pointer, browserName),
            'Pen input needs the Chromium DevTools protocol.'
          )
          await page.goto('/forgot-password')
          const email = page.getByLabel('Email', { exact: true })
          await email.fill('reader@example')
          const button = page.getByRole('button', { name: 'Send reset code' })
          await markClick(button, 'Send reset code')
          await pressWith(page, button, pointer)
          await expectClicked(page, 'Send reset code')
          await expect(
            page
              .getByText('Enter a valid email address.', { exact: true })
              .filter({ visible: true })
          ).toBeVisible()
          await expect(email).toBeFocused()
        })
      })
    }

    test('the email error does not move Send reset code', async ({ page }) => {
      await page.goto('/forgot-password')
      const email = page.getByLabel('Email', { exact: true })
      const button = page.getByRole('button', { name: 'Send reset code' })
      await email.fill('reader@example')
      await animationsSettled(page.locator('body'))
      const before = (await button.boundingBox())!.y
      await email.blur()
      await expect(email).toHaveAttribute('aria-invalid', 'true')
      expect((await button.boundingBox())!.y).toBe(before)
    })

    test('a press on Send reset code that leaves the button does not send', async ({
      page,
    }) => {
      await page.goto('/forgot-password')
      const email = page.getByLabel('Email', { exact: true })
      await email.fill('reader@example')
      const button = page.getByRole('button', { name: 'Send reset code' })
      await markClick(button, 'Send reset code')
      await cancelledPress(page, button)
      await expectNotClicked(page)
      await expect(email).not.toBeFocused()
    })

    test('Tab away from an invalid email shows its error at once', async ({
      page,
    }) => {
      await page.goto('/forgot-password')
      const email = page.getByLabel('Email', { exact: true })
      await email.fill('reader@example')
      await page.keyboard.press('Tab')
      await expect(email).toHaveAttribute('aria-invalid', 'true', {
        timeout: 500,
      })
      await expect(email).toHaveAccessibleDescription(
        'Enter a valid email address.'
      )
    })

    test('reset step reads the code from the link and hides it from history', async ({
      page,
    }) => {
      await page.goto('/reset-password#code=12345678')
      await expect(page.getByLabel('Reset code')).toHaveValue('12345678')
      await expect(page).toHaveURL(/\/reset-password$/)

      await page
        .getByLabel('Email', { exact: true })
        .fill('reader@example.test')
      await page.getByLabel('New password', { exact: true }).fill('short')
      await page.getByRole('button', { name: 'Set new password' }).click()
      await expect(
        page.getByText('Choose a password that meets every requirement.')
      ).toBeVisible()
      await expect(
        page.getByLabel('New password', { exact: true })
      ).toBeFocused()
    })
  })
}
