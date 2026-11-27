import type { Page } from '@playwright/test'

/**
 * In-page audits for the design system suite: contrast of every text and
 * control pair, hit areas, and horizontal overflow. Colors are resolved by
 * painting them on a canvas, so any CSS color (oklch included) and any
 * alpha are measured as the browser draws them.
 */

export type ContrastFailure = {
  text: string
  ratio: number
  needed: number
  fg: string
  bg: string
  where: string
}

export type HitFailure = { name: string; width: number; height: number }

/** Every visible text run against the ground it sits on. */
export async function auditTextContrast(
  page: Page
): Promise<ContrastFailure[]> {
  return page.evaluate(() => {
    const canvas = document.createElement('canvas')
    canvas.width = canvas.height = 1
    const ctx = canvas.getContext('2d', { willReadFrequently: true })!
    const rgb = (layers: string[], topAlpha = 1): [number, number, number] => {
      ctx.clearRect(0, 0, 1, 1)
      layers.forEach((color, i) => {
        ctx.globalAlpha = i === layers.length - 1 ? topAlpha : 1
        ctx.fillStyle = '#000'
        ctx.fillStyle = color
        ctx.fillRect(0, 0, 1, 1)
      })
      ctx.globalAlpha = 1
      const d = ctx.getImageData(0, 0, 1, 1).data
      return [d[0]!, d[1]!, d[2]!]
    }
    const lum = ([r, g, b]: [number, number, number]) => {
      const c = [r, g, b].map((v) => {
        const s = v / 255
        return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
      })
      return 0.2126 * c[0]! + 0.7152 * c[1]! + 0.0722 * c[2]!
    }
    const ratio = (
      a: [number, number, number],
      b: [number, number, number]
    ) => {
      const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p) as [number, number]
      return (x + 0.05) / (y + 0.05)
    }
    const transparent = (c: string) =>
      c === 'transparent' || /rgba\(.*,\s*0\)$/.test(c) || / \/ 0\)$/.test(c)
    /** The grounds under an element, bottom first, to composite. */
    const grounds = (el: Element): string[] => {
      const layers: string[] = []
      for (let node: Element | null = el; node; node = node.parentElement) {
        const style = getComputedStyle(node)
        const mark = style.getPropertyValue('--qt-mark-fill').trim()
        if (node.classList.contains('qt-mark') && mark) layers.unshift(mark)
        else if (!transparent(style.backgroundColor))
          layers.unshift(style.backgroundColor)
        if (layers.length && !/\/|rgba|transparent/.test(layers[0]!)) break
      }
      const root = getComputedStyle(document.documentElement).backgroundColor
      return [transparent(root) ? '#fff' : root, ...layers]
    }
    const visible = (el: Element) => {
      const r = el.getBoundingClientRect()
      if (r.width === 0 || r.height === 0) return false
      const style = getComputedStyle(el)
      return style.visibility !== 'hidden' && style.display !== 'none'
    }
    const exempt = (el: Element) =>
      Boolean(
        el.closest(
          ':disabled, [aria-disabled="true"], [aria-hidden="true"], .qt-visually-hidden, .qt-skip, [inert], dialog:not([open]), code'
        )
      )
    const failures: ContrastFailure[] = []
    const walker = document.createTreeWalker(
      document.body,
      NodeFilter.SHOW_TEXT
    )
    const seen = new Set<Element>()
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const el = n.parentElement
      if (!el || seen.has(el) || !n.textContent?.trim()) continue
      seen.add(el)
      if (!visible(el) || exempt(el)) continue
      const style = getComputedStyle(el)
      let opacity = 1
      for (let p: Element | null = el; p; p = p.parentElement)
        opacity *= Number(getComputedStyle(p).opacity)
      const under = grounds(el)
      const bg = rgb(under)
      const fg = rgb([...under, style.color], opacity)
      const size = parseFloat(style.fontSize)
      const bold = Number(style.fontWeight) >= 700
      const large = size >= 24 || (bold && size >= 18.66)
      const needed = large ? 3 : 4.5
      const r = ratio(fg, bg)
      if (r + 0.01 < needed)
        failures.push({
          text: n.textContent.trim().slice(0, 40),
          ratio: Math.round(r * 100) / 100,
          needed,
          fg: style.color,
          bg: under.at(-1)!,
          where: el.className.toString().slice(0, 60) || el.tagName,
        })
    }
    return failures
  })
}

/**
 * Non-text contrast (WCAG 1.4.11): the boundary of each field and the focus
 * ring against the ground next to them, at least 3:1.
 */
export async function auditControlContrast(
  page: Page
): Promise<ContrastFailure[]> {
  return page.evaluate(() => {
    const canvas = document.createElement('canvas')
    canvas.width = canvas.height = 1
    const ctx = canvas.getContext('2d', { willReadFrequently: true })!
    const rgb = (layers: string[]): [number, number, number] => {
      ctx.clearRect(0, 0, 1, 1)
      for (const color of layers) {
        ctx.fillStyle = color
        ctx.fillRect(0, 0, 1, 1)
      }
      const d = ctx.getImageData(0, 0, 1, 1).data
      return [d[0]!, d[1]!, d[2]!]
    }
    const lum = ([r, g, b]: [number, number, number]) => {
      const c = [r, g, b].map((v) => {
        const s = v / 255
        return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
      })
      return 0.2126 * c[0]! + 0.7152 * c[1]! + 0.0722 * c[2]!
    }
    const ratio = (
      a: [number, number, number],
      b: [number, number, number]
    ) => {
      const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p) as [number, number]
      return (x + 0.05) / (y + 0.05)
    }
    const groundOf = (el: Element): string => {
      for (let n = el.parentElement; n; n = n.parentElement) {
        const c = getComputedStyle(n).backgroundColor
        if (c !== 'transparent' && !/,\s*0\)$/.test(c)) return c
      }
      return getComputedStyle(document.documentElement).backgroundColor
    }
    const root = getComputedStyle(document.documentElement)
    const failures: ContrastFailure[] = []
    const check = (el: Element, color: string, label: string) => {
      const ground = groundOf(el)
      const r = ratio(rgb([ground, color]), rgb([ground]))
      if (r + 0.01 < 3)
        failures.push({
          text: label,
          ratio: Math.round(r * 100) / 100,
          needed: 3,
          fg: color,
          bg: ground,
          where: el.className.toString().slice(0, 60),
        })
    }
    for (const el of document.querySelectorAll(
      '.qt-field__control, .qt-tray__other'
    )) {
      if (el.closest('.qt-field')?.querySelector(':disabled')) continue
      check(el, getComputedStyle(el).borderTopColor, 'field border')
    }
    const focus = root.getPropertyValue('--qt-focus').trim()
    for (const el of document.querySelectorAll(
      '.qt-gallery__specimen, .qt-shell__main, .qt-navbar__list'
    ))
      check(el.firstElementChild ?? el, focus, 'focus ring')
    return failures
  })
}

/**
 * Interactive elements smaller than 44 x 44 CSS px. Inline links inside a
 * sentence are exempt (WCAG 2.5.8), as is a checkbox inside a label that is
 * itself the target.
 */
export async function auditHitAreas(page: Page): Promise<HitFailure[]> {
  return page.evaluate(() => {
    const failures: HitFailure[] = []
    const selector =
      'button, a[href], input, select, textarea, [role="button"], [role="tab"], [role="radio"], [role="menuitem"]'
    for (const el of document.querySelectorAll<HTMLElement>(selector)) {
      const r = el.getBoundingClientRect()
      if (r.width === 0 || r.height === 0) continue
      if (
        el.closest(
          '.qt-visually-hidden, [aria-hidden="true"], dialog:not([open])'
        )
      )
        continue
      if (el.matches('.qt-skip')) continue
      if (el.matches('.qt-prose a, .qt-link[data-variant="inline"]')) continue
      if (el.matches('.qt-activity__link')) {
        // The link stretches over the whole row.
        const row = el.closest('.qt-activity')!.getBoundingClientRect()
        if (row.height >= 44) continue
      }
      let { width, height } = r
      const label = el.closest('label')
      if (label && el.matches('input')) {
        const lr = label.getBoundingClientRect()
        width = Math.max(width, lr.width)
        height = Math.max(height, lr.height)
      }
      if (el.matches('.qt-tray__input')) {
        const box = el.closest('.qt-tray__other')!.getBoundingClientRect()
        width = Math.max(width, box.width)
        height = Math.max(height, box.height)
      }
      if (el.matches('.qt-field__input')) {
        const box = el.closest('.qt-field__control')!.getBoundingClientRect()
        height = Math.max(height, box.height)
      }
      if (width + 0.5 < 44 || height + 0.5 < 44)
        failures.push({
          name:
            el.getAttribute('aria-label') ??
            el.textContent?.trim().slice(0, 40) ??
            el.tagName,
          width: Math.round(width),
          height: Math.round(height),
        })
    }
    return failures
  })
}

/** Page wider than the viewport, and the widest offenders. */
export async function horizontalOverflow(page: Page) {
  return page.evaluate(() => {
    const width = document.documentElement.clientWidth
    const offenders = [...document.querySelectorAll('body *')]
      .filter((el) => {
        const r = el.getBoundingClientRect()
        return r.right > width + 1 && getComputedStyle(el).position !== 'fixed'
      })
      .filter((el) => !el.closest('.qt-tabs, .qt-visually-hidden'))
      .slice(0, 5)
      .map((el) => el.className.toString().slice(0, 60) || el.tagName)
    return {
      scrollWidth: document.documentElement.scrollWidth,
      width,
      offenders,
    }
  })
}
