import AxeBuilder from '@axe-core/playwright'
import type { Page } from '@playwright/test'

/**
 * Checks for a surface that stays light in dark appearance, such as the
 * dashboard (`.ui-light`, #539). The site's dark theme sets dark tokens on
 * `html.dark`; a component on a light surface that read them would put light
 * text on light paper.
 */

const PROPS = [
  'color',
  'background-color',
  'background-image',
  'border-top-color',
  'border-bottom-color',
  'outline-color',
  'fill',
  'stroke',
  'color-scheme',
]

/**
 * The colours of every element under `selector`, with its ::before and
 * ::after. A light surface gives the same list in light and dark appearance.
 */
export function surfaceColours(page: Page, selector: string) {
  return page.evaluate(
    ({ selector, props }) =>
      [...document.querySelectorAll(selector)].flatMap((root) =>
        [root, ...root.querySelectorAll('*')].flatMap((el, index) =>
          ['', '::before', '::after'].map((pseudo) => {
            const style = getComputedStyle(el, pseudo || null)
            const values = props.map((p) => style.getPropertyValue(p))
            return `${index} ${el.tagName}${pseudo} ${values.join(' | ')}`
          })
        )
      ),
    { selector, props: PROPS }
  )
}

/**
 * WCAG A and AA violations under `selector`, plus every contrast axe could
 * not decide: an undecided contrast fails too.
 */
export async function contrastScan(page: Page, selector: string) {
  const results = await new AxeBuilder({ page })
    .include(selector)
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
    .analyze()
  const undecided = results.incomplete.filter((r) => r.id === 'color-contrast')
  return [...results.violations, ...undecided].map(
    (v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`
  )
}
