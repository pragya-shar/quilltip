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
// font request blocked and once with the fonts loaded, and compares the
// layout boxes of the text blocks:
// - every fallback family a text block names must exist as a font face;
// - no heading (h1 to h3) on the page may change its height, that is its
//   number of lines;
// - on the first screen and a half, which a reader sees while the fonts load,
//   the 90th percentile of the text blocks' vertical movement must stay
//   within MAX_P90_MOVE_PX. Further down, a long paragraph in a fallback face
//   can still take one line more or less; that moves nothing in view.
// Positions are layout positions (offsetTop), so transforms and animations do
// not count. See docs/performance/page-load.md.

import {
  chromium,
  firefox,
  webkit,
  type Browser,
  type BrowserType,
} from '@playwright/test'
import { FIXTURE_ARTICLE_PATH } from './convex-fixture'
import { startFixtureBackend } from './fixture-backend'
import { startProductionApp } from './production-app'

const CONVEX_PORT = Number(process.env.PERF_CONVEX_PORT ?? 3299)
const APP_PORT = Number(process.env.PERF_APP_PORT ?? 3199)
const BASE_URL = process.env.PERF_BASE_URL ?? `http://127.0.0.1:${APP_PORT}`

const ENGINES: Record<string, BrowserType> = { chromium, firefox, webkit }
const ENGINE_NAMES = (process.env.PERF_FONT_ENGINES ?? 'chromium webkit')
  .split(/[\s,]+/)
  .filter(Boolean)

const ROUTES = [
  { name: 'landing', path: '/' },
  { name: 'login', path: '/login' },
  { name: 'articles', path: '/articles' },
  { name: 'article', path: FIXTURE_ARTICLE_PATH },
] as const

const VIEWPORTS = [
  { width: 375, height: 812 },
  { width: 1440, height: 900 },
] as const

/** A heading taller or shorter by more than this has changed its lines. */
const HEADING_TOLERANCE_PX = 2
/** Ninetieth-percentile vertical movement of text blocks at the swap. */
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

type Snapshot = {
  blocks: Block[]
  pageHeight: number
  /** Font faces by family, with their weight descriptors. */
  faces: Record<string, string[]>
  /** Web font faces (not local fallback faces) that loaded. */
  fontsLoaded: number
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
      const faces: Record<string, string[]> = {}
      let fontsLoaded = 0
      for (const face of document.fonts) {
        const family = face.family.replace(/^["']|["']$/g, '')
        ;(faces[family] ??= []).push(face.weight)
        // Local fallback faces load too; count only web fonts.
        if (face.status === 'loaded' && !/ Fallback$/.test(family))
          fontsLoaded++
      }
      return {
        blocks,
        pageHeight: document.documentElement.scrollHeight,
        faces,
        fontsLoaded,
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
  loaded: Snapshot
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
  console.log(
    `${label.padEnd(30)} blocks in view ${String(moves.length).padStart(3)}  move p90 ${p90} px  max ${max} px  page ${blocked.pageHeight - loaded.pageHeight} px  headings re-wrapped ${rewrapped.length}`
  )
  if (firstMoved) console.log(`  first block that moves: ${firstMoved.key}`)
  for (const heading of rewrapped)
    failures.push(`${label}: heading changes lines at the swap: ${heading}`)
  if (p90 > MAX_P90_MOVE_PX)
    failures.push(
      `${label}: text moves ${p90} px at the 90th percentile when the fonts arrive > ${MAX_P90_MOVE_PX}`
    )
  return failures
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
            const blocked = await snapshot(browser, route.path, viewport, true)
            const loaded = await snapshot(browser, route.path, viewport, false)
            failures.push(...compare(label, viewport.height, blocked, loaded))
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
