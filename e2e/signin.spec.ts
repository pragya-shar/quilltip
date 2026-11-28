import { expect, test, type Locator, type Page } from '@playwright/test'
import {
  auditControlContrast,
  auditTextContrast,
  horizontalOverflow,
} from './helpers/systemAudit'

// Sign in on the application shell (e2e/fixtures/signin, Convex Auth
// replaced by a fixture with one account, reader@example.com /
// Correct1horse): the sheet keeps what the reader was doing and gives it
// back with nothing sent; errors are plain and land on their field; the
// /signin page returns only to a path on this site.

test.skip(
  !process.env.SIGNIN_FIXTURES,
  'Needs the sign-in fixture server (bun run test:e2e:fixtures --suite signin)'
)

const EMAIL = 'reader@example.com'
const PASSWORD = 'Correct1horse'
const hasTouch = () => Boolean(test.info().project.use.hasTouch)

async function press(target: Locator) {
  if (hasTouch()) await target.tap()
  else await target.click()
}

const tipButton = (page: Page) => page.locator('[data-fixture="tip-button"]')
const sheet = (page: Page, name: string | RegExp = /./) =>
  page.getByRole('dialog', { name })

const activeId = (page: Page) =>
  page.evaluate(() => {
    const el = document.activeElement as HTMLElement | null
    return {
      id: el?.id ?? '',
      name: el?.getAttribute('name') ?? '',
      fixture: el?.getAttribute('data-fixture') ?? '',
      text: el?.textContent?.trim() ?? '',
    }
  })

async function openFromTip(page: Page, path = '/article') {
  await page.goto(path)
  await expect(tipButton(page)).toHaveAttribute('data-phase', 'signed-out')
  await tipButton(page).focus()
  await press(tipButton(page))
  const dialog = sheet(page, /^Tip this line/)
  await expect(dialog).toBeVisible()
  return dialog
}

async function fill(dialog: Locator, email: string, password: string) {
  await dialog.getByLabel('Email').fill(email)
  await dialog.getByLabel('Password', { exact: true }).fill(password)
}

test.describe('a kept intent comes back, and nothing is sent', () => {
  test('sign in from a tip: back on the line with the tip ready, sent only on a new press', async ({
    page,
  }) => {
    const dialog = await openFromTip(page)
    await expect(dialog).toHaveAccessibleName('Tip this line $1.00')
    await expect(dialog).toContainText(
      'She wrote down every coin she ever gave away.'
    )
    await expect(dialog).toContainText(
      'Nothing is sent until you tap Tip again.'
    )
    await fill(dialog, EMAIL, PASSWORD)
    await press(dialog.getByRole('button', { name: 'Sign in', exact: true }))
    // Signed in, then confirmed by the backend, then the sheet closes.
    await expect(dialog).toBeHidden()
    expect(new URL(page.url()).pathname).toBe('/article')
    await expect(tipButton(page)).toHaveAttribute('data-phase', 'signed-in')
    await expect(page.locator('[data-line-chosen]')).toHaveCount(1)
    await expect(tipButton(page)).toHaveText('Tip this line $1.00')
    await expect(tipButton(page)).toHaveAttribute('data-sends', '0')
    await expect
      .poll(async () => (await activeId(page)).fixture)
      .toBe('tip-button')
    // A tip needs its own press.
    await press(tipButton(page))
    await expect(tipButton(page)).toHaveAttribute('data-sends', '1')
  })

  test('steps after sign-in may speak, but never hold the reader or act', async ({
    page,
  }) => {
    const dialog = await openFromTip(page, '/article?after=notice,slow,fail')
    await fill(dialog, EMAIL, PASSWORD)
    await press(dialog.getByRole('button', { name: 'Sign in', exact: true }))
    // The slow step is left behind at its bound; the failing one is skipped.
    await expect(dialog).toBeHidden({ timeout: 3_000 })
    await expect(
      page.getByText('Two drafts on this device are waiting in Write.')
    ).toBeVisible()
    // A notice never covers the sheet: it showed only once the sheet left.
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await expect(tipButton(page)).toHaveAttribute('data-sends', '0')
  })

  test('the intent’s amount is a ceiling: never raised', async ({ page }) => {
    const dialog = await openFromTip(page, '/article?ceiling=75')
    await expect(dialog).toHaveAccessibleName('Tip this line $0.75')
    await fill(dialog, EMAIL, PASSWORD)
    await press(dialog.getByRole('button', { name: 'Sign in', exact: true }))
    await expect(dialog).toBeHidden()
    await expect(tipButton(page)).toHaveText('Tip this line $0.50')
    await expect(tipButton(page)).toHaveAttribute('data-sends', '0')
  })

  test('creating an account sends nothing and asks for nothing else', async ({
    page,
  }) => {
    const dialog = await openFromTip(page)
    await press(dialog.getByRole('button', { name: 'Create an account' }))
    await expect(
      dialog.getByLabel('Password', { exact: true })
    ).toHaveAttribute('autocomplete', 'new-password')
    await expect(dialog.getByRole('textbox')).toHaveCount(2)
    await fill(dialog, 'new.reader@example.com', 'Fresh1password')
    await press(dialog.getByRole('button', { name: 'Create account' }))
    await expect(dialog).toBeHidden()
    await expect(tipButton(page)).toHaveAttribute('data-phase', 'signed-in')
    await expect(tipButton(page)).toHaveAttribute('data-sends', '0')
  })

  test('while the backend has not answered the new token, it is not signed out', async ({
    page,
  }) => {
    const dialog = await openFromTip(page, '/article?slow-confirm')
    await fill(dialog, EMAIL, PASSWORD)
    await press(dialog.getByRole('button', { name: 'Sign in', exact: true }))
    await expect(dialog.getByText('Signing you in…')).toBeVisible()
    await expect(tipButton(page)).toHaveAttribute('data-phase', 'confirming')
    await expect(dialog).toBeHidden()
    await expect(tipButton(page)).toHaveAttribute('data-phase', 'signed-in')
    await expect(tipButton(page)).toHaveAttribute('data-sends', '0')
  })

  test('signing out clears a kept intent', async ({ page }) => {
    const stored = () =>
      page.evaluate(() => sessionStorage.getItem('quilltip:sign-in-intent'))
    const dialog = await openFromTip(page)
    // Kept as soon as the sheet's form is there.
    await expect(dialog.getByLabel('Email')).toBeVisible()
    await expect.poll(stored).not.toBeNull()
    await page.keyboard.press('Escape')
    // Signed in elsewhere: the tip's page never took its intent back.
    await page.goto('/signin?returnTo=%2Fsignin')
    await page.getByLabel('Email').fill(EMAIL)
    await page.getByLabel('Password', { exact: true }).fill(PASSWORD)
    await press(page.getByRole('button', { name: 'Sign in', exact: true }))
    // A way back to the sign-in page itself is refused: Today.
    await page.waitForURL((url) => url.pathname === '/')
    expect(await stored()).not.toBeNull()
    await press(page.locator('[data-fixture="sign-out"]'))
    await expect.poll(stored).toBeNull()
  })
})

test.describe('errors are plain, specific and land on their field', () => {
  test('a wrong password says so, on the password field', async ({ page }) => {
    const dialog = await openFromTip(page)
    await fill(dialog, EMAIL, 'Wrong1password')
    await press(dialog.getByRole('button', { name: 'Sign in', exact: true }))
    const field = dialog.getByLabel('Password', { exact: true })
    await expect(field).toHaveAttribute('aria-invalid', 'true')
    await expect(dialog).toContainText('That email and password do not match.')
    await expect.poll(async () => (await activeId(page)).name).toBe('password')
    await expect(tipButton(page)).toHaveAttribute('data-sends', '0')
  })

  test('an email already in use says so, on the email field', async ({
    page,
  }) => {
    const dialog = await openFromTip(page)
    await press(dialog.getByRole('button', { name: 'Create an account' }))
    await fill(dialog, EMAIL, 'Another1password')
    await press(dialog.getByRole('button', { name: 'Create account' }))
    await expect(dialog).toContainText(
      'An account with this email already exists, so no new account was made. Sign in with it instead.'
    )
    await expect.poll(async () => (await activeId(page)).name).toBe('email')
  })

  test('no connection says so, and focus goes to the message', async ({
    page,
  }) => {
    const dialog = await openFromTip(page, '/article?offline')
    await fill(dialog, EMAIL, PASSWORD)
    await press(dialog.getByRole('button', { name: 'Sign in', exact: true }))
    await expect(dialog).toContainText(
      'We could not reach Quilltip, so you are not signed in and nothing was sent. Check your connection and try again.'
    )
    await expect
      .poll(async () => (await activeId(page)).text)
      .toContain('We could not reach Quilltip')
  })

  test('an empty form points at the first field to fix', async ({ page }) => {
    const dialog = await openFromTip(page)
    await press(dialog.getByRole('button', { name: 'Sign in', exact: true }))
    await expect(dialog).toContainText('Enter your email.')
    await expect.poll(async () => (await activeId(page)).name).toBe('email')
  })

  test('password managers can fill it', async ({ page }) => {
    const dialog = await openFromTip(page)
    const form = dialog.locator('form')
    await expect(form).toHaveCount(1)
    const email = form.getByLabel('Email')
    const password = form.getByLabel('Password', { exact: true })
    await expect(email).toHaveAttribute('autocomplete', 'username')
    await expect(email).toHaveAttribute('type', 'email')
    await expect(password).toHaveAttribute('autocomplete', 'current-password')
    await expect(password).toHaveAttribute('type', 'password')
    await expect(password).not.toHaveAttribute('passwordrules')
    await press(dialog.getByRole('button', { name: 'Create an account' }))
    // A generated password always meets the server's rule.
    await expect(password).toHaveAttribute('autocomplete', 'new-password')
    await expect(password).toHaveAttribute(
      'passwordrules',
      'minlength: 8; required: lower; required: upper; required: digit;'
    )
    for (const input of [email, password])
      expect(
        Number.parseFloat(
          await input.evaluate((el) => getComputedStyle(el).fontSize)
        )
      ).toBeGreaterThanOrEqual(16)
  })

  test('the Terms line is one sentence with a link, and no checkbox', async ({
    page,
  }) => {
    const dialog = await openFromTip(page)
    await expect(dialog.getByRole('checkbox')).toHaveCount(0)
    const terms = dialog.locator('.qt-signin__terms')
    await expect(terms).toHaveText('By continuing you agree to the Terms.')
    await expect(terms.getByRole('link', { name: 'Terms' })).toHaveAttribute(
      'href',
      '/terms'
    )
  })
})

test.describe('the /signin page', () => {
  test('a full page load between the sheet and signing in still brings the tip back', async ({
    page,
  }) => {
    await openFromTip(page, '/article?ceiling=75')
    // The intent is kept in this tab before any sign-in.
    await expect
      .poll(() =>
        page.evaluate(() => sessionStorage.getItem('quilltip:sign-in-intent'))
      )
      .not.toBeNull()
    await page.reload()
    await page.goto('/signin?returnTo=%2Farticle%3Fceiling%3D75')
    await page.getByLabel('Email').fill(EMAIL)
    await page.getByLabel('Password', { exact: true }).fill(PASSWORD)
    await press(page.getByRole('button', { name: 'Sign in', exact: true }))
    await page.waitForURL(/\/article/)
    await expect(tipButton(page)).toHaveAttribute('data-phase', 'signed-in')
    await expect(page.locator('[data-line-chosen]')).toHaveCount(1)
    // Within the ceiling ($0.75): the largest choice at or below it.
    await expect(tipButton(page)).toHaveText('Tip this line $0.50')
    await expect(tipButton(page)).toHaveAttribute('data-sends', '0')
    // Taken once: gone from storage.
    expect(
      await page.evaluate(() =>
        sessionStorage.getItem('quilltip:sign-in-intent')
      )
    ).toBeNull()
  })

  test('signs in and goes back to the path it came from', async ({ page }) => {
    await page.goto('/signin?returnTo=%2Farticle')
    await page.getByLabel('Email').fill(EMAIL)
    await page.getByLabel('Password', { exact: true }).fill(PASSWORD)
    await press(page.getByRole('button', { name: 'Sign in', exact: true }))
    await page.waitForURL(/\/article$/)
    await expect(tipButton(page)).toHaveAttribute('data-phase', 'signed-in')
    await expect(tipButton(page)).toHaveAttribute('data-sends', '0')
  })

  for (const returnTo of [
    '//evil.example',
    'https://evil.example',
    '/%2F%2Fevil.example',
    '/%5Cevil.example',
  ])
    test(`never returns to ${returnTo}`, async ({ page }) => {
      await page.goto(`/signin?returnTo=${encodeURIComponent(returnTo)}`)
      await page.getByLabel('Email').fill(EMAIL)
      await page.getByLabel('Password', { exact: true }).fill(PASSWORD)
      await press(page.getByRole('button', { name: 'Sign in', exact: true }))
      await page.waitForURL((url) => url.pathname === '/')
      expect(new URL(page.url()).host).toBe(
        new URL(test.info().project.use.baseURL!).host
      )
    })
})

test.describe('the page follows the person', () => {
  test('someone already signed in goes straight back, with no sign-in page left behind', async ({
    page,
  }) => {
    await page.goto('/signin?returnTo=%2Farticle')
    await page.getByLabel('Email').fill(EMAIL)
    await page.getByLabel('Password', { exact: true }).fill(PASSWORD)
    await press(page.getByRole('button', { name: 'Sign in', exact: true }))
    await page.waitForURL(/\/article$/)
    await page.goto('/signin?returnTo=%2Farticle%3Fceiling%3D75')
    await page.waitForURL(/\/article\?ceiling=75$/)
    await expect(page.getByRole('button', { name: 'Sign in' })).toHaveCount(0)
    // Replaced, not pushed: Back does not land on the sign-in page.
    await page.goBack()
    await expect(page).toHaveURL(/\/article$/)
  })

  test('the heading says what the form does', async ({ page }) => {
    await page.goto('/signin')
    const heading = page.getByRole('heading', { level: 1 })
    await expect(heading).toHaveText('Sign in to Quilltip')
    await press(page.getByRole('button', { name: 'Create an account' }))
    await expect(heading).toHaveText('Create your account')
    await press(page.getByRole('button', { name: 'Sign in', exact: true }))
    await expect(heading).toHaveText('Sign in to Quilltip')
    await page.goto('/signin?mode=create')
    await expect(heading).toHaveText('Create your account')
  })

  test('a password that breaks the rule says the rule once', async ({
    page,
  }) => {
    await page.goto('/signin?mode=create')
    await page.getByLabel('Email').fill('new.reader@example.com')
    await page.getByLabel('Password', { exact: true }).fill('short')
    await press(page.getByRole('button', { name: 'Create account' }))
    const form = page.locator('form')
    await expect(form).toContainText('Use at least 8 characters')
    expect((await form.innerText()).match(/8 characters/g)).toHaveLength(1)
  })
})

test.describe('the way back is returnTo', () => {
  test('next is not read on /signin: it goes to Today', async ({ page }) => {
    await page.goto('/signin?next=%2Farticle')
    await page.getByLabel('Email').fill(EMAIL)
    await page.getByLabel('Password', { exact: true }).fill(PASSWORD)
    await press(page.getByRole('button', { name: 'Sign in', exact: true }))
    await page.waitForURL((url) => url.pathname === '/')
  })

  test('it is carried through a password reset and back to sign in', async ({
    page,
  }) => {
    await page.goto('/signin?returnTo=%2Farticle')
    await expect(
      page.getByRole('link', { name: 'Forgot your password?' })
    ).toHaveAttribute('href', '/signin/reset?returnTo=%2Farticle')
    await page.goto('/signin/reset?returnTo=%2Farticle#code=12345678')
    await page.getByLabel('Email', { exact: true }).fill(EMAIL)
    await page.getByLabel('New password').fill('Brand1newpass')
    await press(page.getByRole('button', { name: 'Change password' }))
    await expect(
      page.locator('#content').getByRole('link', { name: 'Sign in' })
    ).toHaveAttribute('href', '/signin?returnTo=%2Farticle')
  })
})

test.describe('resetting a password', () => {
  test('asks for a code, then a new password, then sign in with it', async ({
    page,
  }) => {
    await page.goto('/signin')
    await page.getByLabel('Email', { exact: true }).fill(EMAIL)
    // The email typed there fills the reset page.
    await press(page.getByRole('link', { name: 'Forgot your password?' }))
    await page.waitForURL(/\/signin\/reset$/)
    await expect(page.getByLabel('Email', { exact: true })).toHaveValue(EMAIL)
    await press(page.getByRole('button', { name: 'Send a code' }))
    await expect
      .poll(async () => (await activeId(page)).text)
      .toBe('Check your email')
    await press(page.getByRole('button', { name: 'Enter your code' }))
    await page.getByLabel('Code from the email').fill('12345678')
    await page.getByLabel('New password').fill('Brand1newpass')
    await press(page.getByRole('button', { name: 'Change password' }))
    await expect(
      page.getByText('Your password is changed. Sign in with it.')
    ).toBeVisible()
    await press(page.locator('#content').getByRole('link', { name: 'Sign in' }))
    await page.waitForURL(/\/signin$/)
    await page.getByLabel('Email', { exact: true }).fill(EMAIL)
    await page.getByLabel('Password', { exact: true }).fill('Brand1newpass')
    await press(page.getByRole('button', { name: 'Sign in', exact: true }))
    await page.waitForURL((url) => url.pathname === '/')
  })

  test('a link from the email opens on the code, filled in', async ({
    page,
  }) => {
    const seen: string[] = []
    page.on('request', (request) => seen.push(request.url()))
    page.on('console', (message) => seen.push(message.text()))
    await page.goto('/signin/reset#code=12345678')
    await expect(page.getByLabel('Code from the email')).toHaveValue('12345678')
    await expect(page.getByLabel('New password')).toHaveAttribute(
      'autocomplete',
      'new-password'
    )
    // Read once, then gone from the address; never in a request or the log.
    await expect.poll(() => new URL(page.url()).hash).toBe('')
    expect(new URL(page.url()).pathname).toBe('/signin/reset')
    // A reload has no code to read: it opens on asking for one.
    await page.reload()
    await expect(
      page.getByRole('button', { name: 'Send a code' })
    ).toBeVisible()
    await expect(page.getByLabel('Code from the email')).toHaveCount(0)
    expect(seen.filter((text) => text.includes('12345678'))).toEqual([])
  })

  test('a wrong code says so, on the code field', async ({ page }) => {
    await page.goto('/signin/reset#code=87654321')
    await page.getByLabel('Email', { exact: true }).fill(EMAIL)
    await page.getByLabel('New password').fill('Brand1newpass')
    await press(page.getByRole('button', { name: 'Change password' }))
    await expect(page.getByLabel('Code from the email')).toHaveAttribute(
      'aria-invalid',
      'true'
    )
    await expect(page.getByText(/That code didn’t work/)).toBeVisible()
    await expect.poll(async () => (await activeId(page)).name).toBe('code')
  })
})

test.describe('fit and contrast', () => {
  for (const scheme of ['light', 'dark'] as const)
    test(`the sheet meets contrast (${scheme})`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: scheme })
      const dialog = await openFromTip(page)
      await page.waitForFunction(() =>
        document
          .getAnimations()
          .every(
            (a) =>
              a.playState !== 'running' ||
              a.effect?.getComputedTiming().iterations === Infinity
          )
      )
      await press(dialog.getByRole('button', { name: 'Sign in', exact: true }))
      await expect(dialog).toContainText('Enter your email.')
      expect(await auditTextContrast(page)).toEqual([])
      expect(await auditControlContrast(page)).toEqual([])
    })

  test('no horizontal scroll at 360', async ({ page }) => {
    test.skip(!hasTouch(), 'phone width')
    await page.setViewportSize({ width: 360, height: 760 })
    await openFromTip(page)
    const overflow = await horizontalOverflow(page)
    expect(
      overflow.scrollWidth,
      String(overflow.offenders)
    ).toBeLessThanOrEqual(overflow.width)
  })
})
