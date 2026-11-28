// Font fallback check for a local production build (the same build and
// fixture backend as perf:budget). It needs no secrets.
//
//   NEXT_PUBLIC_CONVEX_URL=http://127.0.0.1:3299 bun run build
//   bun run perf:font-fallbacks
//
// Text paints in a metric-matched local face (app/font-fallbacks.css) until
// the web font arrives. When that face is missing, or its values do not match
// the web font, lines re-wrap at the swap and everything below them moves.
// For each route, engine and width, this loads the page twice, once with every
// font request blocked and once with the fonts loaded, and compares them:
// - every fallback family a text block names must exist as a font face;
// - for each font (family, weight, style), the text set in it must take the
//   same width in both runs, within MAX_WIDTH_DIFFERENCE. The width is the
//   sum of each element's line pieces over the page, so it does not depend on
//   where lines break. This is what the faces control: a face matched to the
//   wrong file is 8 to 17 percent off, a matched one at most 5 percent;
// - no heading (h1 to h3) on the page may change its height, that is its
//   number of lines;
// - on the first screen and a half, which a reader sees while the fonts load,
//   the 90th percentile of the text blocks' vertical movement must stay within
//   MAX_P90_MOVE_PX. Positions are layout positions (offsetTop), so transforms
//   and animations do not count. The width rule alone lets a face a few
//   percent too wide pass while text in view moves, so both are gated. Only
//   the cases in MOVEMENT_EXEMPT, each with its reason, are not.
// See docs/performance/page-load.md.

import {
  chromium,
  firefox,
  webkit,
  type Browser,
  type BrowserType,
} from '@playwright/test'
import { FIXTURE_ARTICLE_PATH } from './convex-fixture'
import { startFixtureBackend } from './fixture-backend'
import {
  fixtureBackendPort,
  perfPort,
  startProductionApp,
} from './production-app'

const CONVEX_PORT = fixtureBackendPort()
const APP_PORT = await perfPort('PERF_APP_PORT')
const BASE_URL = process.env.PERF_BASE_URL ?? `http://127.0.0.1:${APP_PORT}`

const ENGINES: Record<string, BrowserType> = { chromium, firefox, webkit }
const ENGINE_NAMES = (process.env.PERF_FONT_ENGINES ?? 'chromium webkit')
  .split(/[\s,]+/)
  .filter(Boolean)

// The four measured routes, and /guide, which uses Landing Syne at 500 and
// Wallet Syne (the 600 file at every weight). PERF_FONT_ROUTES adds paths,
// for example `/support /terms`, to look at other pages: their faces and
// widths are checked, their movement is only reported.
const ROUTES: { name: string; path: string; gateMovement: boolean }[] = [
  { name: 'landing', path: '/', gateMovement: true },
  { name: 'login', path: '/login', gateMovement: true },
  { name: 'articles', path: '/articles', gateMovement: true },
  { name: 'article', path: FIXTURE_ARTICLE_PATH, gateMovement: true },
  { name: 'guide', path: '/guide', gateMovement: true },
  ...(process.env.PERF_FONT_ROUTES ?? '')
    .split(/[\s,]+/)
    .filter(Boolean)
    .map((extra) => ({ name: extra, path: extra, gateMovement: false })),
]

/**
 * Route and width cases whose movement is reported but not gated, each with
 * the reason. Every other gated case measures 0 px in Chromium and WebKit.
 */
const MOVEMENT_EXEMPT: { route: string; width: number; reason: string }[] = [
  {
    route: 'guide',
    width: 375,
    reason:
      'the "Send 1 test XLM" paragraph fills two lines of its 335 px box ' +
      '(663 px of text in Work Sans, 669 px in the matched fallback) and ' +
      'takes a third in the fallback, so the text below moves 26 px in ' +
      'Chromium, WebKit and Firefox (0 px on overhaul/v2, without fallback ' +
      'faces). Work Sans 400 text on the page is 1.02 times as wide in its ' +
      'fallback, within the width rule.',
  },
]

const VIEWPORTS = [
  { width: 375, height: 812 },
  { width: 1440, height: 900 },
] as const

/** A heading taller or shorter by more than this has changed its lines. */
const HEADING_TOLERANCE_PX = 2
/**
 * The largest allowed width difference of a font's text, as a fraction. On
 * the fixture build, matched faces measure 0.985 to 1.051 over 13 routes in
 * three engines; a face matched to the wrong file measures 0.879 to 0.891 or
 * 1.148 to 1.168, and the earlier bold values 1.076 to 1.111 in WebKit.
 */
const MAX_WIDTH_DIFFERENCE = 0.07
/** A font with fewer characters than this on the page is not compared. */
const MIN_FONT_CHARS = 30
/** Ninetieth-percentile vertical movement of text in view at the swap. */
const MAX_P90_MOVE_PX = 4
/** The part of the page, in viewport heights, where movement counts. */
const FIRST_SCREENS = 1.5

const TEXT_BLOCKS = 'h1, h2, h3, h4, p, li, blockquote, dt, dd, figcaption'

type Block = {
  key: string
  tag: string
  top: number
  height: number
  family: string
  weight: string
}

/** An element's own text: the summed width of its line pieces. */
type TextRun = {
  key: string
  width: number
  chars: number
  family: string
  font: string
}

type Snapshot = {
  blocks: Block[]
  runs: TextRun[]
  pageHeight: number
  /** Font faces by family, with their weight descriptors. */
  faces: Record<string, string[]>
  /** Web font faces (not local fallback faces) that loaded. */
  fontsLoaded: number
  /**
   * Each fallback face with its status. A face whose local() sources match no
   * installed font ends in `error`, and its text falls through to the generic
   * family.
   */
  fallbackFaces: string[]
}

async function snapshot(
  browser: Browser,
  routePath: string,
  viewport: (typeof VIEWPORTS)[number],
  blockFonts: boolean
): Promise<Snapshot> {
  const context = await browser.newContext({ viewport })
  try {
    const page = await context.newPage()
    if (blockFonts)
      await page.route(/\.(woff2?|ttf|otf)(\?|$)/, (route) => route.abort())
    await page.goto(BASE_URL + routePath, {
      waitUntil: 'load',
      timeout: 60_000,
    })
    // Fonts settle (or fail), then late client work settles.
    await page.evaluate(() => document.fonts.ready)
    await page.waitForTimeout(2000)
    await page.evaluate(() => document.fonts.ready)
    return await page.evaluate((selector) => {
      const layoutTop = (element: HTMLElement) => {
        let top = 0
        for (
          let node: HTMLElement | null = element;
          node;
          node = node.offsetParent as HTMLElement | null
        )
          top += node.offsetTop
        return top
      }
      const seen = new Map<string, number>()
      const blocks = []
      for (const element of document.querySelectorAll<HTMLElement>(selector)) {
        const text = (element.textContent ?? '').replace(/\s+/g, ' ').trim()
        if (!text || element.offsetHeight === 0) continue
        const tag = element.tagName.toLowerCase()
        const base = `${tag}:${text.slice(0, 60)}`
        const count = seen.get(base) ?? 0
        seen.set(base, count + 1)
        const style = getComputedStyle(element)
        blocks.push({
          key: `${base}#${count}`,
          tag,
          top: layoutTop(element),
          height: element.offsetHeight,
          family: style.fontFamily,
          weight: style.fontWeight,
        })
      }
      // Every element's own text nodes, measured as the sum of the widths of
      // their line pieces, so a different line break changes little.
      const runs = []
      const seenRun = new Map<string, number>()
      const range = document.createRange()
      for (const element of document.querySelectorAll<HTMLElement>('body *')) {
        if (/^(SCRIPT|STYLE|NOSCRIPT|TEMPLATE|svg)$/i.test(element.tagName))
          continue
        let width = 0
        let text = ''
        for (const node of element.childNodes) {
          if (node.nodeType !== Node.TEXT_NODE || !node.textContent?.trim())
            continue
          text += node.textContent
          range.selectNodeContents(node)
          for (const rect of range.getClientRects()) width += rect.width
        }
        text = text.replace(/\s+/g, ' ').trim()
        if (!text || width === 0) continue
        const base = `${element.tagName.toLowerCase()}:${text.slice(0, 60)}`
        const count = seenRun.get(base) ?? 0
        seenRun.set(base, count + 1)
        const style = getComputedStyle(element)
        runs.push({
          key: `${base}#${count}`,
          width,
          chars: text.length,
          family: style.fontFamily,
          font: `${style.fontFamily.split(',')[0]} ${style.fontWeight} ${style.fontStyle}`,
        })
      }
      const faces: Record<string, string[]> = {}
      const fallbackFaces: string[] = []
      let fontsLoaded = 0
      for (const face of document.fonts) {
        const family = face.family.replace(/^["']|["']$/g, '')
        ;(faces[family] ??= []).push(face.weight)
        if (/ Fallback$/.test(family))
          fallbackFaces.push(
            `${family} ${face.weight} ${face.style}: ${face.status}`
          )
        // Local fallback faces load too; count only web fonts.
        if (face.status === 'loaded' && !/ Fallback$/.test(family))
          fontsLoaded++
      }
      return {
        blocks,
        runs,
        pageHeight: document.documentElement.scrollHeight,
        faces,
        fontsLoaded,
        fallbackFaces: [...new Set(fallbackFaces)],
      }
    }, TEXT_BLOCKS)
  } finally {
    await context.close()
  }
}

/** True when a face's weight descriptor (`600` or `500 800`) covers `weight`. */
function covers(descriptor: string, weight: number): boolean {
  const [low, high = low] = descriptor
    .split(/\s+/)
    .map((part) =>
      part === 'normal' ? 400 : part === 'bold' ? 700 : Number(part)
    )
  return weight >= low! && weight <= high!
}

function percentile(values: number[], fraction: number): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[
    Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))
  ]!
}

function compare(
  label: string,
  viewportHeight: number,
  blocked: Snapshot,
  loaded: Snapshot,
  movementGated: boolean
): string[] {
  const failures: string[] = []
  if (loaded.fontsLoaded === 0)
    failures.push(`${label}: no web font loaded in the loaded run`)
  if (blocked.fontsLoaded > 0)
    failures.push(`${label}: a web font loaded in the blocked run`)

  // Every fallback family a block names must exist for the block's weight.
  const missing = new Set<string>()
  for (const block of loaded.blocks) {
    for (const family of block.family.split(',')) {
      const name = family.trim().replace(/^["']|["']$/g, '')
      if (!/ Fallback$/.test(name)) continue
      const weight = Number(block.weight) || 400
      if (!(loaded.faces[name] ?? []).some((d) => covers(d, weight)))
        missing.add(`${name} at ${weight}`)
    }
  }
  for (const face of missing)
    failures.push(`${label}: no font face for ${face}`)

  const loadedByKey = new Map(loaded.blocks.map((block) => [block.key, block]))
  const moves: number[] = []
  const rewrapped: string[] = []
  for (const block of blocked.blocks) {
    const other = loadedByKey.get(block.key)
    if (!other) continue
    if (other.top < viewportHeight * FIRST_SCREENS)
      moves.push(Math.abs(block.top - other.top))
    if (
      /^h[1-3]$/.test(block.tag) &&
      Math.abs(block.height - other.height) > HEADING_TOLERANCE_PX
    )
      rewrapped.push(
        `${block.key.split('#')[0]} (${block.height} px blocked, ${other.height} px loaded)`
      )
  }
  // The first block that moves points at what re-wrapped above it.
  const firstMoved = blocked.blocks.find((block) => {
    const other = loadedByKey.get(block.key)
    return other && Math.abs(block.top - other.top) > HEADING_TOLERANCE_PX
  })
  const p90 = percentile(moves, 0.9)
  const max = Math.max(0, ...moves)

  // Widths of text set in a fallback stack (a face this app defines), summed
  // per font across the page: one string's letters can make it a few percent
  // wider or narrower, while a face matched to the wrong file is off for
  // every text in that font.
  const loadedRuns = new Map(loaded.runs.map((run) => [run.key, run]))
  const fonts = new Map<
    string,
    { blocked: number; loaded: number; chars: number }
  >()
  for (const run of blocked.runs) {
    const other = loadedRuns.get(run.key)
    if (!other || !/ Fallback['"]?(,|$)/.test(run.family)) continue
    const sums = fonts.get(other.font) ?? { blocked: 0, loaded: 0, chars: 0 }
    sums.blocked += run.width
    sums.loaded += other.width
    sums.chars += other.chars
    fonts.set(other.font, sums)
  }
  const ratios = [...fonts]
    .filter(([, sums]) => sums.chars >= MIN_FONT_CHARS)
    .map(([font, sums]) => ({ font, ratio: sums.blocked / sums.loaded }))
    .sort((a, b) => Math.abs(b.ratio - 1) - Math.abs(a.ratio - 1))
  console.log(
    `${label.padEnd(30)} fonts ${String(ratios.length).padStart(2)}  worst ${ratios[0] ? `${ratios[0].ratio.toFixed(3)} (${ratios[0].font})` : '-'}  in view: move p90 ${p90} px  max ${max} px  headings re-wrapped ${rewrapped.length}`
  )
  if (firstMoved) console.log(`  first block that moves: ${firstMoved.key}`)
  for (const heading of rewrapped)
    failures.push(`${label}: heading changes lines at the swap: ${heading}`)
  if (movementGated && p90 > MAX_P90_MOVE_PX)
    failures.push(
      `${label}: text in view moves ${p90} px at the 90th percentile when the fonts arrive > ${MAX_P90_MOVE_PX}`
    )
  for (const { font, ratio } of ratios)
    if (Math.abs(ratio - 1) > MAX_WIDTH_DIFFERENCE)
      failures.push(
        `${label}: text in ${font} is ${ratio.toFixed(3)} times as wide in its fallback face`
      )
  if (failures.length > 0)
    console.log(
      `  fallback faces, fonts blocked: ${blocked.fallbackFaces.join('; ')}`
    )
  return failures
}

async function main() {
  const backend = startFixtureBackend(CONVEX_PORT)
  const app = await startProductionApp(APP_PORT, BASE_URL, { backend })
  const failures: string[] = []
  try {
    for (const engineName of ENGINE_NAMES) {
      const engine = ENGINES[engineName]
      if (!engine) throw new Error(`Unknown engine ${engineName}`)
      const browser = await engine.launch()
      try {
        for (const route of ROUTES) {
          for (const viewport of VIEWPORTS) {
            const label = `${engineName} ${route.name} ${viewport.width}px`
            const exempt = MOVEMENT_EXEMPT.find(
              (entry) =>
                entry.route === route.name && entry.width === viewport.width
            )
            if (exempt)
              console.log(`  ${label}: movement not gated: ${exempt.reason}`)
            const blocked = await snapshot(browser, route.path, viewport, true)
            const loaded = await snapshot(browser, route.path, viewport, false)
            failures.push(
              ...compare(
                label,
                viewport.height,
                blocked,
                loaded,
                route.gateMovement && !exempt
              )
            )
          }
        }
      } finally {
        await browser.close()
      }
    }
  } finally {
    app?.kill()
    backend.closeAllConnections()
    backend.close()
  }
  if (failures.length > 0) {
    console.error(`\nFont fallback check failed:\n- ${failures.join('\n- ')}`)
    process.exit(1)
  }
  console.log('\nFont fallback check passed.')
  process.exit(0)
}

await main()
