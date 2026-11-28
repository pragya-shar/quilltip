import { expect, test, type Locator, type Page } from '@playwright/test'
import {
  auditControlContrast,
  auditTextContrast,
  horizontalOverflow,
} from './helpers/systemAudit'
import { PRESS_HOLD_MS } from '../system/pressGuard'

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

/** Opens the sheet from the tip; it starts with creating an account, and
 * `asReturning` switches it to signing in, as a returning reader does. */
async function openFromTip(page: Page, path = '/article', asReturning = true) {
  await page.goto(path)
  await expect(tipButton(page)).toHaveAttribute('data-phase', 'signed-out')
  await tipButton(page).focus()
  await press(tipButton(page))
  const dialog = sheet(page, /^Tip this line/)
  await expect(dialog).toBeVisible()
  if (asReturning)
    await press(dialog.getByRole('button', { name: 'I have an account' }))
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
    // A tip needs its own press, once the shell's hold after a sheet
    // closes has passed (a press inside it is swallowed by design).
    await page.waitForTimeout(PRESS_HOLD_MS)
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

test('the first open draws the sheet with its form in the same frame', async ({
  page,
}) => {
  // Every animation frame from the press: is a dialog open, does it hold
  // the form, and was a loading placeholder ever drawn?
  await page.addInitScript(() => {
    const w = window as unknown as {
      __frames: { open: boolean; form: boolean; busy: boolean }[]
      __watch: () => void
    }
    w.__frames = []
    w.__watch = () => {
      const tick = () => {
        const dialog = document.querySelector('dialog[open]')
        w.__frames.push({
          open: Boolean(dialog),
          form: Boolean(dialog?.querySelector('input[name="email"]')),
          busy: Boolean(dialog?.querySelector('[aria-busy="true"]')),
        })
        if (w.__frames.length < 90) requestAnimationFrame(tick)
      }
      requestAnimationFrame(tick)
    }
  })
  await page.goto('/article')
  await expect(tipButton(page)).toHaveAttribute('data-phase', 'signed-out')
  await page.evaluate(() =>
    (window as unknown as { __watch: () => void }).__watch()
  )
  await press(tipButton(page))
  await expect(sheet(page, /^Tip this line/)).toBeVisible()
  const frames = await page.evaluate(
    () =>
      (
        window as unknown as {
          __frames: { open: boolean; form: boolean; busy: boolean }[]
        }
      ).__frames
  )
  const first = frames.find((frame) => frame.open)
  expect(first).toEqual({ open: true, form: true, busy: false })
  expect(frames.some((frame) => frame.busy)).toBe(false)
})

test.describe('above a keyboard', () => {
  // The visible height left by a phone keyboard: 390 x 844 and 360 x 640
  // less the keyboard. The real keyboard (iOS Safari) is not run here.
  for (const size of [
    { width: 390, height: 508 },
    { width: 360, height: 380 },
  ])
    test(`the password, its button and the other way in fit at ${size.width} x ${size.height}`, async ({
      page,
    }) => {
      test.skip(!hasTouch(), 'phone widths')
      await page.setViewportSize(size)
      // The longest line a reader may choose, clamped in the sheet.
      const dialog = await openFromTip(page, '/article?long-line', false)
      await dialog.getByLabel('Email').fill('new.reader@example.com')
      await dialog.getByLabel('Email').press('Enter')
      const password = dialog.getByLabel('Password', { exact: true })
      await expect(password).toBeFocused()
      await expect(password).toHaveAttribute('enterkeyhint', 'go')
      await expect(dialog.getByLabel('Email')).toHaveAttribute(
        'enterkeyhint',
        'next'
      )
      // One block the shell keeps in view: the password and both buttons.
      const keep = dialog.locator('[data-sheet-keep]')
      await expect(keep).toHaveCount(1)
      await expect(keep.getByLabel('Password', { exact: true })).toHaveCount(1)
      for (const name of [
        'Show password',
        'Create account',
        'I have an account',
      ])
        await expect(keep.getByRole('button', { name })).toHaveCount(1)
      // Enter on the email moved on; it sent nothing and said nothing.
      await expect(dialog.getByText('Enter your password.')).toHaveCount(0)
      await page.waitForTimeout(300)
      for (const target of [
        password,
        dialog.getByRole('button', { name: 'Create account' }),
        dialog.getByRole('button', { name: 'I have an account' }),
      ]) {
        const box = (await target.boundingBox())!
        expect(
          box.y,
          (await target.textContent()) ?? ''
        ).toBeGreaterThanOrEqual(0)
        expect(box.y + box.height).toBeLessThanOrEqual(size.height)
      }
    })
})

test('a long line takes three rows, and the form and both buttons stay in view at 360 x 640', async ({
  page,
}) => {
  test.skip(!hasTouch(), 'phone widths')
  await page.setViewportSize({ width: 360, height: 640 })
  const dialog = await openFromTip(page, '/article?long-line', false)
  const line = dialog.locator('.qt-signin-sheet__line')
  // The whole line is there for a screen reader; three rows are shown.
  expect((await line.textContent())!.length).toBe(300)
  const rows = await line.evaluate(
    (el) => el.clientHeight / parseFloat(getComputedStyle(el).lineHeight)
  )
  expect(Math.round(rows)).toBe(3)
  for (const target of [
    dialog.getByLabel('Email'),
    dialog.getByLabel('Password', { exact: true }),
    dialog.getByRole('button', { name: 'Show password' }),
    dialog.getByRole('button', { name: 'Create account' }),
    dialog.getByRole('button', { name: 'I have an account' }),
  ]) {
    const box = (await target.boundingBox())!
    expect(box.y).toBeGreaterThanOrEqual(0)
    expect(box.y + box.height).toBeLessThanOrEqual(640)
  }
})

test('show password sits on the password field, and shows it', async ({
  page,
}) => {
  const dialog = await openFromTip(page)
  const password = dialog.getByLabel('Password', { exact: true })
  const show = dialog.getByRole('button', { name: 'Show password' })
  // The field's frame (the input sits inset inside it).
  const frame = (await dialog
    .locator('.qt-signin__password .qt-field__control')
    .boundingBox())!
  const toggle = (await show.boundingBox())!
  // In the label's row, just above the field, at its trailing edge (its
  // hit area runs a few pixels past the edge; its text ends at the edge).
  expect(toggle.y + toggle.height).toBeLessThanOrEqual(frame.y + 4)
  expect(toggle.y + toggle.height).toBeGreaterThan(frame.y - 30)
  expect(
    Math.abs(toggle.x + toggle.width - (frame.x + frame.width))
  ).toBeLessThanOrEqual(12)
  await password.fill('Correct1horse')
  await press(show)
  await expect(password).toHaveAttribute('type', 'text')
  await expect(
    dialog.getByRole('button', { name: 'Hide password' })
  ).toHaveAttribute('aria-pressed', 'true')
})

test.describe('a newcomer from a tip creates an account first', () => {
  test('the sheet starts with creating an account; signing in is one full-size press away', async ({
    page,
  }) => {
    const dialog = await openFromTip(page, '/article', false)
    await expect(
      dialog.getByRole('button', { name: 'Create account' })
    ).toBeVisible()
    await expect(
      dialog.getByLabel('Password', { exact: true })
    ).toHaveAttribute('autocomplete', 'new-password')
    const other = dialog.getByRole('button', { name: 'I have an account' })
    const box = (await other.boundingBox())!
    expect(box.height).toBeGreaterThanOrEqual(44)
    const submit = (await dialog
      .getByRole('button', { name: 'Create account' })
      .boundingBox())!
    expect(box.width).toBeCloseTo(submit.width, 0)
  })

  test('opened for a returning reader, it starts with signing in and keeps the tip', async ({
    page,
  }) => {
    const dialog = await openFromTip(page, '/article?returning', false)
    await expect(dialog).toHaveAccessibleName(/^Tip this line/)
    await expect(
      dialog.getByRole('button', { name: 'Sign in', exact: true })
    ).toBeVisible()
    await fill(dialog, EMAIL, PASSWORD)
    await press(dialog.getByRole('button', { name: 'Sign in', exact: true }))
    await expect(dialog).toBeHidden()
    await expect(page.locator('[data-line-chosen]')).toHaveCount(1)
    await expect(tipButton(page)).toHaveAttribute('data-sends', '0')
  })

  test('a returning reader who types their password into it is signed in', async ({
    page,
  }) => {
    const dialog = await openFromTip(page, '/article', false)
    await fill(dialog, EMAIL, PASSWORD)
    await press(dialog.getByRole('button', { name: 'Create account' }))
    await expect(dialog).toBeHidden()
    await expect(tipButton(page)).toHaveAttribute('data-phase', 'signed-in')
    await expect(tipButton(page)).toHaveAttribute('data-sends', '0')
  })

  test('an email that has an account, with another password, turns the form into sign-in', async ({
    page,
  }) => {
    const dialog = await openFromTip(page, '/article', false)
    await fill(dialog, EMAIL, 'Another1password')
    await press(dialog.getByRole('button', { name: 'Create account' }))
    await expect(dialog).toContainText(
      'You already have an account with this email. Enter its password to sign in.'
    )
    await expect(
      dialog.getByRole('button', { name: 'Sign in', exact: true })
    ).toBeVisible()
    await expect(dialog.getByLabel('Email')).toHaveValue(EMAIL)
    const password = dialog.getByLabel('Password', { exact: true })
    await expect(password).toHaveValue('')
    await expect(password).toBeFocused()
    await expect(password).toHaveAttribute('autocomplete', 'current-password')
    await password.fill(PASSWORD)
    await press(dialog.getByRole('button', { name: 'Sign in', exact: true }))
    await expect(dialog).toBeHidden()
    await expect(tipButton(page)).toHaveAttribute('data-sends', '0')
  })
})

test('an intent built by hand still signs in, on the same page', async ({
  page,
}) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.goto('/article?hand-made&ceiling=50')
  await press(page.locator('[data-fixture="hand-made"]'))
  const dialog = sheet(page, 'Sign in to Quilltip')
  await expect(dialog).toBeVisible()
  await fill(dialog, EMAIL, PASSWORD)
  await press(dialog.getByRole('button', { name: 'Sign in', exact: true }))
  await expect(dialog).toBeHidden()
  await expect(page).toHaveURL(/\/article\?hand-made&ceiling=50$/)
  await expect(tipButton(page)).toHaveAttribute('data-phase', 'signed-in')
  await expect(tipButton(page)).toHaveAttribute('data-sends', '0')
  expect(errors).toEqual([])
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
      'minlength: 8; maxlength: 256;'
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
    await press(page.getByRole('button', { name: 'I have an account' }))
    await expect(heading).toHaveText('Sign in to Quilltip')
    await page.goto('/signin?mode=create')
    await expect(heading).toHaveText('Create your account')
  })

  test('a password that breaks the rule says the rule once', async ({
    page,
  }) => {
    await page.goto('/signin?mode=create')
    await page.getByLabel('Email').fill('new.reader@example.com')
    await page.getByLabel('Password', { exact: true }).fill('seven77')
    await press(page.getByRole('button', { name: 'Create account' }))
    const form = page.locator('form')
    await expect(form).toContainText('Use at least 8 characters.')
    expect((await form.innerText()).match(/8 characters/g)).toHaveLength(1)
  })
})

test.describe('nothing moves under the pointer', () => {
  // An invalid last field, then a press on the button: the field blurs as
  // the press starts, and nothing may appear then and move the button.
  // Errors come with the press itself, so the press lands.
  // Where layout puts the button. A press may scale it about its centre
  // (the pressed state, a transform); only a change of place moves it
  // from under the pointer.
  const placeOf = (button: Locator) =>
    button.evaluate((el: HTMLElement) => {
      let x = 0
      let y = 0
      let at: HTMLElement | null = el
      while (at) {
        x += at.offsetLeft
        y += at.offsetTop
        at = at.offsetParent as HTMLElement | null
      }
      return { x, y, width: el.offsetWidth, height: el.offsetHeight }
    })

  async function pressStays(page: Page, button: Locator, landed: Locator) {
    const before = await placeOf(button)
    const box = (await button.boundingBox())!
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
    await page.mouse.down()
    const during = await placeOf(button)
    await page.mouse.up()
    expect(during).toEqual(before)
    await expect(landed).toBeVisible()
  }

  test('signing in', async ({ page }) => {
    await page.goto('/signin')
    await page.getByLabel('Email').fill(EMAIL)
    await page.getByLabel('Password', { exact: true }).focus()
    await pressStays(
      page,
      page.getByRole('button', { name: 'Sign in', exact: true }),
      page.getByText('Enter your password.')
    )
  })

  test('creating an account', async ({ page }) => {
    await page.goto('/signin?mode=create')
    await page.getByLabel('Email').fill('new.reader@example.com')
    await page.getByLabel('Password', { exact: true }).fill('seven77')
    await pressStays(
      page,
      page.getByRole('button', { name: 'Create account' }),
      page.getByText('Use at least 8 characters.')
    )
  })

  test('choosing a new password', async ({ page }) => {
    await page.goto('/signin/reset#code=12345678')
    await page.getByLabel('Email', { exact: true }).fill(EMAIL)
    await page.getByLabel('New password').fill('short')
    await pressStays(
      page,
      page.getByRole('button', { name: 'Change password' }),
      page.getByText('Use at least 8 characters.')
    )
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
