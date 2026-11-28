import { expect, test, type Locator, type Page } from '@playwright/test'

/**
 * Two details of the shared header and the phone menu, in Chromium and
 * WebKit (early-taps.config.ts, fixture backend):
 * - #666: no arrow character that iPhone can draw as a colour emoji; the
 *   arrow is an icon, hidden from assistive technology. The source scan in
 *   scripts/ui/emoji-glyphs.test.ts covers the other pages (Read next needs
 *   live data, which the fixture backend does not send);
 * - #667: in dark appearance the theme button still reads on the cream
 *   chrome (3:1 for its icon, and a visible focus ring).
 */

/** Arrows that iOS can draw as an emoji tile (Emoji=Yes, text by default). */
const EMOJI_ARROWS = /[↔-↙↩↪⤴⤵➡⬅-⬇]/

async function visibleText(page: Page) {
  return page.evaluate(() => document.body.innerText)
}

for (const width of [375, 1440]) {
  test(`#666 arrows are icons, not emoji-capable text, at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 })
    await page.goto('/support')
    if (width === 375) {
      await page.getByRole('button', { name: 'Open navigation menu' }).click()
      await expect(
        page.getByRole('dialog', { name: 'Find your way' })
      ).toBeVisible()
    }
    const signUp = page.getByRole('link', { name: 'Sign up', exact: true })
    await expect(
      signUp.locator('svg[data-arrow="north-east"]')
    ).toHaveAttribute('aria-hidden', 'true')
    expect(await visibleText(page)).not.toMatch(EMOJI_ARROWS)
  })
}

/** WCAG contrast of two `rgb()` colours. */
function contrast(a: string, b: string) {
  const luminance = (rgb: string) => {
    const [r, g, bl] = rgb
      .match(/[\d.]+/g)!
      .slice(0, 3)
      .map((value) => {
        const c = Number(value) / 255
        return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
      })
    return 0.2126 * r! + 0.7152 * g! + 0.0722 * bl!
  }
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (hi! + 0.05) / (lo! + 0.05)
}

/** The icon colour, the surface behind it, and the focus ring's colour. */
async function themeButtonColours(button: Locator) {
  return button.evaluate((element) => {
    let surface = element as Element | null
    let background = 'rgba(0, 0, 0, 0)'
    while (surface) {
      background = getComputedStyle(surface).backgroundColor
      if (!/rgba\(.*,\s*0\)$/.test(background) && background !== 'transparent')
        break
      surface = surface.parentElement
    }
    const icon = element.querySelector('svg')!
    const style = getComputedStyle(element)
    // An outline, or a box-shadow ring (the button's own focus style).
    const shadowRing = style.boxShadow
      .split(/,(?![^(]*\))/)
      .map((shadow) => shadow.trim())
      .find(
        (shadow) => !/^rgba\([^)]*,\s*0\)/.test(shadow) && shadow !== 'none'
      )
    const ring =
      style.outlineStyle !== 'none'
        ? style.outlineColor
        : (shadowRing?.match(/rgba?\([^)]*\)/)?.[0] ?? null)
    return {
      focusVisible: element.matches(':focus-visible'),
      icon: getComputedStyle(icon).color,
      background,
      ring,
    }
  })
}

for (const width of [375, 1440]) {
  test(`#667 the theme button reads on the chrome in dark appearance at ${width}px`, async ({
    page,
    browserName,
  }) => {
    await page.emulateMedia({ colorScheme: 'dark' })
    await page.setViewportSize({ width, height: 900 })
    await page.goto('/support')
    if (width === 375)
      await page.getByRole('button', { name: 'Open navigation menu' }).click()
    const button = page.getByRole('button', { name: 'Switch to light mode' })
    await expect(button).toBeVisible()
    // Reach it by keyboard, so the focus ring shows (WebKit tabs to links
    // and buttons with Alt+Tab).
    const tab = browserName === 'webkit' ? 'Alt+Tab' : 'Tab'
    for (let i = 0; i < 40; i++) {
      if (await button.evaluate((b) => b === document.activeElement)) break
      await page.keyboard.press(tab)
    }
    const colours = await themeButtonColours(button)
    expect(
      {
        focusVisible: colours.focusVisible,
        icon: contrast(colours.icon, colours.background) >= 3,
        ring:
          colours.ring !== null &&
          contrast(colours.ring, colours.background) >= 3,
      },
      JSON.stringify(colours)
    ).toEqual({ focusVisible: true, icon: true, ring: true })
  })
}
