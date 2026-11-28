import { expect, type Locator, type Page } from '@playwright/test'

/**
 * Checks for a payment notice, by role and text (#610). A notice that
 * appears because of the reader's action ("announced") has a heading title.
 * The title takes focus when nothing more specific holds it, and then the
 * notice's live region stays empty. Otherwise focus stays put and the live
 * region reads the notice. A notice that is there from the start is neither.
 */

/** Longer than the 120 ms delay before a live region gets its text. */
const SETTLE_MS = 400

/** The notice's live region, found by the title it would read. */
const regionFor = (scope: Locator, title: string) =>
  scope.getByRole('status').filter({ hasText: title })

export type NoticeHeading = {
  /** The title's heading level on this surface. */
  level: 2 | 3 | 4 | 5 | 6
  /** What the focused title reads as its description; null for none. */
  description: string | RegExp | null
}

/**
 * The title took focus as a heading at the surface's level, reads the
 * detail as its description, and the notice is not also announced.
 */
export async function expectNoticeTookFocus(
  page: Page,
  scope: Locator,
  title: string,
  { level, description }: NoticeHeading
) {
  const heading = scope.getByRole('heading', { name: title, level })
  await expect(heading).toBeFocused()
  await expect(heading).toHaveAccessibleDescription(description ?? '')
  // Also as the referenced elements' own text, joined as the ids are: a
  // label and a detail in one element read without a space between them in
  // some screen readers ("Stellar testnetYour tab").
  const referenced = await heading.evaluate((element) =>
    (element.getAttribute('aria-describedby') ?? '')
      .split(/\s+/)
      .filter(Boolean)
      .map((id) => document.getElementById(id)?.textContent?.trim() ?? '')
      .join(' ')
  )
  if (description === null) expect(referenced).toBe('')
  else if (typeof description === 'string') expect(referenced).toBe(description)
  else expect(referenced).toMatch(description)
  await page.waitForTimeout(SETTLE_MS)
  await expect(regionFor(scope, title)).toHaveCount(0)
}

/** Focus stayed elsewhere; the live region reads the notice once. */
export async function expectNoticeAnnounced(scope: Locator, title: string) {
  const heading = scope.getByRole('heading', { name: title })
  await expect(heading).toBeVisible()
  await expect(regionFor(scope, title)).toHaveCount(1)
  await expect(heading).not.toBeFocused()
}

/** A notice present from the start: no heading, no focus, no announcement. */
export async function expectNoticeQuiet(
  page: Page,
  scope: Locator,
  title: string
) {
  await expect(scope.getByText(title, { exact: true })).toBeVisible()
  await expect(scope.getByRole('heading', { name: title })).toHaveCount(0)
  await page.waitForTimeout(SETTLE_MS)
  await expect(regionFor(scope, title)).toHaveCount(0)
}
