// Font fallback check for a local production build (the same build and
// fixture backend as perf:budget). It needs no secrets.
//
//   NEXT_PUBLIC_CONVEX_URL=http://127.0.0.1:3299 bun run build
//   bun run perf:font-fallbacks
//
// Text paints in a metric-matched local face (system/font-fallbacks.css and
// app/font-fallbacks.css) until the web font arrives. For each route, engine
// and width:
// - Faces and widths. The page loads once with every font request blocked and
//   once with the fonts in the cache (a first load, then a second), and the
//   two are compared. Every fallback family a text block names must exist as
//   a font face. For each font (family, weight, style), the text set in it
//   must take the same width in both, within MAX_WIDTH_DIFFERENCE, and within
//   READING_WIDTH_DIFFERENCE for the reading faces. The width is the sum of
//   each element's line pieces over the page, so it does not depend on where
//   lines break: it is a calibration figure for the face, not a rule for any
//   one line.
// - Movement. The page loads once with the fonts held back past the block
//   period, and its layout is compared before and after they arrive, in the
//   same page view. No heading (h1 to h3) may change its height. On the first
//   screen and a half, the text blocks' vertical movement must be 0 px on the
//   shell's routes, whose reading faces use font-display: optional (a view
//   that started in the fallback stays in it), and its 90th percentile within
//   MAX_P90_MOVE_PX on the legacy routes, whose faces swap. Positions are
//   layout positions (offsetTop), so transforms and animations do not count.
//   Only the cases in MOVEMENT_EXEMPT, each with its reason, are not gated.
// - The next page view, on the shell's routes: after the late first view,
//   a client navigation away and back reads in the web fonts, at the widths
//   of the cached view (system/readingFaceUpgrade.ts).
// - The mixed case, on the shell's routes: the roman face on time and the
//   italic faces late (a first view, where only the roman file is preloaded).
//   It must move 0 px too.
// See docs/performance/page-load.md.

import {
  chromium,
  firefox,
  webkit,
  type Browser,
  type BrowserType,
  type Page,
} from '@playwright/test'
import { startFixtureBackend } from './fixture-backend'
import { startProductionApp } from './production-app'
import { FONT_FALLBACK_ROUTES, SURFACE_FONT_FALLBACK } from './routes'

const CONVEX_PORT = Number(process.env.PERF_CONVEX_PORT ?? 3299)
const APP_PORT = Number(process.env.PERF_APP_PORT ?? 3199)
const BASE_URL = process.env.PERF_BASE_URL ?? `http://127.0.0.1:${APP_PORT}`

const ENGINES: Record<string, BrowserType> = { chromium, firefox, webkit }
const ENGINE_NAMES = (process.env.PERF_FONT_ENGINES ?? 'chromium webkit')
  .split(/[\s,]+/)
  .filter(Boolean)

// The legacy routes not yet replaced and every package's
// (scripts/perf/routes). PERF_FONT_ROUTES adds paths, for example
// `/support /terms`, to look at other pages: their faces and widths are
// checked, their movement is only reported.
const ROUTES: { name: string; path: string; gateMovement: boolean }[] = [
  ...FONT_FALLBACK_ROUTES,
  ...(process.env.PERF_FONT_ROUTES ?? '')
    .split(/[\s,]+/)
    .filter(Boolean)
    .map((extra) => ({ name: extra, path: extra, gateMovement: false })),
]

/** The shell's routes (every package's), whose text must not move at all. */
const SHELL_PATHS = new Set(SURFACE_FONT_FALLBACK.map((route) => route.path))

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
/**
 * The same for the reading faces (Literata's fallbacks). Their worst font on
 * the shell's pages measures 0.987 to 1.018; a line's own ratio varies by
 * about 1.4 percent either way with its letters, which is why movement is
 * held by font-display: optional and not by these values.
 */
const READING_WIDTH_DIFFERENCE = 0.025
/** Families of the reading faces' fallbacks. */
const READING_FALLBACK = /Quilltip (Read|Display)[A-Za-z ]* Fallback/
/** How long font responses are held back in the movement runs: well past
 * the block period, and after the page's own client work has settled. */
const LATE_MS = 5000
/** When the movement runs take their first layout, after the document. */
const BEFORE_MS = 2500
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

const FONT_FILES = /\.(woff2?|ttf|otf)(\?|$)/

/** Blocked: no font file loads. Cached: the fonts are in the cache, so the
 * view paints in the web fonts (a face with font-display: optional that was
 * not preloaded is used only from the cache in Chromium). */
async function snapshot(
  browser: Browser,
  routePath: string,
  viewport: (typeof VIEWPORTS)[number],
  mode: 'blocked' | 'cached'
): Promise<Snapshot> {
  const context = await browser.newContext({ viewport })
  try {
    const page = await context.newPage()
    if (mode === 'blocked')
      await page.route(FONT_FILES, (route) => route.abort())
    const visits = mode === 'cached' ? 2 : 1
    for (let visit = 0; visit < visits; visit++) {
      await page.goto(BASE_URL + routePath, {
        waitUntil: 'load',
        timeout: 60_000,
      })
      // Fonts settle (or fail), then late client work settles.
      await page.evaluate(() => document.fonts.ready)
      await page.waitForTimeout(2000)
      await page.evaluate(() => document.fonts.ready)
    }
    return await capture(page)
  } finally {
    await context.close()
  }
}

/** One page view with the font files in `held` answering after LATE_MS:
 * its layout before they arrive and after. */
async function lateView(
  browser: Browser,
  routePath: string,
  viewport: (typeof VIEWPORTS)[number],
  held: RegExp,
  /** A shell page to visit by client navigation and come back from, after
   * the fonts arrive: the page then reads in the upgraded faces. */
  roundTrip?: string
): Promise<{ before: Snapshot; after: Snapshot; next?: Snapshot }> {
  const context = await browser.newContext({ viewport })
  try {
    const page = await context.newPage()
    await page.route(
      (url) => FONT_FILES.test(url.pathname) && held.test(url.pathname),
      async (route) => {
        await new Promise((done) => setTimeout(done, LATE_MS))
        await route.continue().catch(() => {})
      }
    )
    await page.goto(BASE_URL + routePath, {
      waitUntil: 'domcontentloaded',
      timeout: 60_000,
    })
    await page.waitForTimeout(BEFORE_MS)
    const before = await capture(page)
    await page.waitForTimeout(LATE_MS)
    await page.evaluate(() => document.fonts.ready)
    await page.waitForTimeout(1000)
    const after = await capture(page)
    if (!roundTrip) return { before, after }
    // The upgrade loads the faces under their second names when idle.
    await page
      .locator('html[data-reading-faces-loaded]')
      .waitFor({ state: 'attached', timeout: 15_000 })
    for (const to of [roundTrip, routePath]) {
      await page.evaluate(
        (path) =>
          (
            window as unknown as {
              next: { router: { push: (path: string) => void } }
            }
          ).next.router.push(path),
        to
      )
      await page.waitForURL((url) => url.pathname === to.split('?')[0])
      await page.waitForTimeout(1000)
    }
    return { before, after, next: await capture(page) }
  } finally {
    await context.close()
  }
}

async function capture(page: Page): Promise<Snapshot> {
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
      if (face.status === 'loaded' && !/ Fallback$/.test(family)) fontsLoaded++
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

function checkFaces(
  label: string,
  blocked: Snapshot,
  loaded: Snapshot
): { failures: string[]; summary: string } {
  const failures: string[] = []
  if (loaded.fontsLoaded === 0)
    failures.push(`${label}: no web font loaded in the cached run`)
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

  // Widths of text set in a fallback stack (a face this app defines), summed
  // per font across the page: one string's letters can make it a few percent
  // wider or narrower, while a face matched to the wrong file is off for
  // every text in that font.
  const loadedRuns = new Map(loaded.runs.map((run) => [run.key, run]))
  const fonts = new Map<
    string,
    { blocked: number; loaded: number; chars: number; reading: boolean }
  >()
  for (const run of blocked.runs) {
    const other = loadedRuns.get(run.key)
    if (!other || !/ Fallback['"]?(,|$)/.test(run.family)) continue
    const sums = fonts.get(other.font) ?? {
      blocked: 0,
      loaded: 0,
      chars: 0,
      reading: READING_FALLBACK.test(run.family),
    }
    sums.blocked += run.width
    sums.loaded += other.width
    sums.chars += other.chars
    fonts.set(other.font, sums)
  }
  const ratios = [...fonts]
    .filter(([, sums]) => sums.chars >= MIN_FONT_CHARS)
    .map(([font, sums]) => ({
      font,
      ratio: sums.blocked / sums.loaded,
      limit: sums.reading ? READING_WIDTH_DIFFERENCE : MAX_WIDTH_DIFFERENCE,
    }))
    .sort((a, b) => Math.abs(b.ratio - 1) - Math.abs(a.ratio - 1))
  for (const { font, ratio, limit } of ratios)
    if (Math.abs(ratio - 1) > limit)
      failures.push(
        `${label}: text in ${font} is ${ratio.toFixed(3)} times as wide in its fallback face (limit ${limit})`
      )
  if (failures.length > 0)
    console.log(
      `  fallback faces, fonts blocked: ${blocked.fallbackFaces.join('; ')}`
    )
  const summary = `fonts ${String(ratios.length).padStart(2)}  worst ${ratios[0] ? `${ratios[0].ratio.toFixed(3)} (${ratios[0].font})` : '-'}`
  return { failures, summary }
}

/**
 * After a late first view and a client navigation away and back, the page
 * reads in the web fonts: its reading text takes the widths of the cached
 * view (system/readingFaceUpgrade.ts).
 */
function checkUpgrade(
  label: string,
  cached: Snapshot,
  next: Snapshot | undefined
): string[] {
  const upgradeLabel = `${label} next page view`
  if (!next) return [`${upgradeLabel}: not measured`]
  const cachedRuns = new Map(cached.runs.map((run) => [run.key, run]))
  let width = 0
  let reference = 0
  for (const run of next.runs) {
    const other = cachedRuns.get(run.key)
    if (!other || !READING_FALLBACK.test(run.family)) continue
    width += run.width
    reference += other.width
  }
  const ratio = reference > 0 ? width / reference : 0
  console.log(
    `${upgradeLabel.padEnd(30)} reading text ${ratio.toFixed(3)} times its width in the web fonts`
  )
  return Math.abs(ratio - 1) > 0.002
    ? [
        `${upgradeLabel}: after a late first view and a client navigation, reading text is ${ratio.toFixed(3)} times its width in the web fonts (not upgraded)`,
      ]
    : []
}

/** Movement within one page view, from before the fonts arrive to after. */
function checkMovement(
  label: string,
  viewportHeight: number,
  { before, after }: { before: Snapshot; after: Snapshot },
  gate: 'still' | 'p90' | 'none'
): { failures: string[]; summary: string } {
  const failures: string[] = []
  const afterByKey = new Map(after.blocks.map((block) => [block.key, block]))
  const moves: number[] = []
  const rewrapped: string[] = []
  for (const block of before.blocks) {
    const other = afterByKey.get(block.key)
    if (!other) continue
    if (other.top < viewportHeight * FIRST_SCREENS)
      moves.push(Math.abs(block.top - other.top))
    if (
      /^h[1-3]$/.test(block.tag) &&
      Math.abs(block.height - other.height) > HEADING_TOLERANCE_PX
    )
      rewrapped.push(
        `${block.key.split('#')[0]} (${block.height} px before, ${other.height} px after)`
      )
  }
  // The first block that moves points at what re-wrapped above it.
  const firstMoved = before.blocks.find((block) => {
    const other = afterByKey.get(block.key)
    return other && Math.abs(block.top - other.top) > 0
  })
  const p90 = percentile(moves, 0.9)
  const max = Math.max(0, ...moves)
  if (firstMoved)
    console.log(`  ${label}: first block that moves: ${firstMoved.key}`)
  for (const heading of rewrapped)
    failures.push(
      `${label}: heading changes lines when the fonts arrive: ${heading}`
    )
  if (gate === 'still' && max > 0)
    failures.push(
      `${label}: text in view moves ${max} px when the fonts arrive late (the shell's text must not move)`
    )
  if (gate === 'p90' && p90 > MAX_P90_MOVE_PX)
    failures.push(
      `${label}: text in view moves ${p90} px at the 90th percentile when the fonts arrive > ${MAX_P90_MOVE_PX}`
    )
  return {
    failures,
    summary: `in view: move p90 ${p90} px  max ${max} px  headings re-wrapped ${rewrapped.length}`,
  }
}

async function main() {
  const backend = startFixtureBackend(CONVEX_PORT)
  const app = await startProductionApp(APP_PORT, BASE_URL)
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
            const shell = SHELL_PATHS.has(route.path)
            const gate =
              !route.gateMovement || exempt ? 'none' : shell ? 'still' : 'p90'
            const blocked = await snapshot(
              browser,
              route.path,
              viewport,
              'blocked'
            )
            const cached = await snapshot(
              browser,
              route.path,
              viewport,
              'cached'
            )
            const faces = checkFaces(label, blocked, cached)
            const late = await lateView(
              browser,
              route.path,
              viewport,
              /./,
              shell
                ? route.path === '/shelf'
                  ? '/system/reading'
                  : '/shelf'
                : undefined
            )
            const moved = checkMovement(label, viewport.height, late, gate)
            console.log(
              `${label.padEnd(30)} ${faces.summary}  ${moved.summary}`
            )
            failures.push(...faces.failures, ...moved.failures)
            if (!shell) continue
            failures.push(...checkUpgrade(label, cached, late.next))
            // A first view: the roman face preloaded and on time, the italic
            // faces (not preloaded) late.
            const mixedLabel = `${label} roman on time, italic late`
            const mixed = checkMovement(
              mixedLabel,
              viewport.height,
              await lateView(browser, route.path, viewport, /italic/i),
              gate
            )
            console.log(`${mixedLabel.padEnd(30)} ${mixed.summary}`)
            failures.push(...mixed.failures)
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
