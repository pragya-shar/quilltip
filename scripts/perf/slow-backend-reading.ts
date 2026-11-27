// Public reading with a slow, silent or failing backend (#428). Public pages
// wait for their server reads before the first byte, so each read has a time
// limit (lib/seo/publicReadTimeout.ts). Runs against the fixture build of
// perf:budget, after perf:no-script-reading; needs no secrets.
//
//   NEXT_PUBLIC_CONVEX_URL=http://127.0.0.1:3299 bun run build
//   bun run perf:slow-backend-reading
//
// For the article list, a writer's page and an article, with the backend
// silent (never answers), slower than the limit, and failing:
// - the first byte and the whole page arrive within the limits of the reads
//   in sequence, plus a margin;
// - the page answers 200 (an existing article must not answer 404 because
//   the backend was slow), with `noindex` and `no-store`;
// - with JavaScript off, in Chromium and WebKit, at 375 px, the page shows a
//   heading that it could not be loaded, a "Try again" link and the header's
//   home link (the header's other links sit in its menu at this width).
// Then, with the backend answering again, each page shows its content: a
// timed-out read was not cached.

import { chromium, webkit, type Page } from '@playwright/test'
import { rmSync } from 'fs'
import { join } from 'path'
import { PUBLIC_READ_TIMEOUT_MS } from '../../lib/seo/publicReadTimeout'
import { fixtureArticlePath } from './convex-fixture'
import { fixtureBackendBehaviour, startFixtureBackend } from './fixture-backend'
import { startProductionApp } from './production-app'
import { READING } from './no-script-reading'

/** Rendering and CI noise on top of the read limits. */
const MARGIN_MS = 1000

/** Each page, the reads it waits for in sequence, and what it shows. */
const PAGES = [
  { path: READING.list, readsInSequence: 1, content: READING.articleTitle },
  // The proxy's route check, then the writer and their articles together.
  { path: READING.writer, readsInSequence: 2, content: READING.writerName },
  // The proxy's route check, then the article.
  { path: READING.article, readsInSequence: 2, content: READING.prose },
]
const FALLBACK_TEXT = 'could not be loaded right now'
const RETRY_LINK = 'Try again'

const CONVEX_PORT = Number(process.env.PERF_CONVEX_PORT ?? 3299)
const APP_PORT = Number(process.env.PERF_APP_PORT ?? 3199)
const BASE_URL = `http://127.0.0.1:${APP_PORT}`
const ENGINES = (process.env.PERF_READING_ENGINES ?? 'chromium,webkit').split(
  ','
)

type Behaviour = 'silent' | 'slow' | 'error'

/**
 * A URL of the same page with its own cache entry, so each browser load reads
 * the backend: a slow read that finished after an earlier load gave up has
 * cached real content, as it should.
 */
function coldPath(path: string, run: number) {
  if (path === READING.list) return `${path}?tag=cold-${run}`
  if (path === READING.article) return fixtureArticlePath(2 + run)
  return path // The writer's reads are not cached.
}

const boundFor = (readsInSequence: number) =>
  readsInSequence * PUBLIC_READ_TIMEOUT_MS + MARGIN_MS

async function timedFetch(path: string, limitMs: number) {
  const started = performance.now()
  const response = await fetch(BASE_URL + path, {
    redirect: 'manual',
    signal: AbortSignal.timeout(limitMs + 5000),
  })
  const firstByte = performance.now() - started
  const body = await response.text()
  return { response, body, firstByte, whole: performance.now() - started }
}

async function readableWithoutScripts(page: Page) {
  const visible = (locator: ReturnType<Page['locator']>) =>
    locator
      .first()
      .waitFor({ state: 'visible', timeout: 2000 })
      .then(() => true)
      .catch(() => false)
  const missing: string[] = []
  if (!(await visible(page.getByRole('heading', { name: FALLBACK_TEXT }))))
    missing.push(`no heading "… ${FALLBACK_TEXT}."`)
  if (!(await visible(page.getByRole('link', { name: RETRY_LINK }))))
    missing.push(`no "${RETRY_LINK}" link`)
  if (!(await visible(page.getByRole('banner').locator('a[href="/"]'))))
    missing.push('no home link in the header')
  return missing
}

async function main() {
  // Start from an empty data cache, so the pages really read the backend.
  rmSync(join(process.cwd(), '.next', 'cache', 'fetch-cache'), {
    recursive: true,
    force: true,
  })
  const backend = startFixtureBackend(CONVEX_PORT)
  const app = await startProductionApp(APP_PORT, BASE_URL)
  const failures: string[] = []
  try {
    const behaviours: Behaviour[] = ['silent', 'error', 'slow']
    let browserRun = 0
    for (const behaviour of behaviours) {
      fixtureBackendBehaviour.mode = behaviour
      fixtureBackendBehaviour.delayMs = PUBLIC_READ_TIMEOUT_MS * 2
      for (const { path, readsInSequence } of PAGES) {
        const bound = boundFor(readsInSequence)
        const label = `${behaviour} backend, ${path}`
        const result = await timedFetch(path, bound).catch((error: unknown) => {
          console.log(`${label.padEnd(56)} no answer`)
          failures.push(`${label}: no answer (${String(error)})`)
          return null
        })
        if (!result) continue
        const { response, body, firstByte, whole } = result
        console.log(
          `${label.padEnd(56)} ${response.status}  first byte ${Math.round(firstByte)} ms  whole page ${Math.round(whole)} ms  (bound ${bound} ms)`
        )
        if (behaviour !== 'error' && firstByte > bound)
          failures.push(
            `${label}: first byte after ${Math.round(firstByte)} ms`
          )
        if (behaviour !== 'error' && whole > bound)
          failures.push(`${label}: whole page after ${Math.round(whole)} ms`)
        if (response.status !== 200)
          failures.push(`${label}: status ${response.status}, expected 200`)
        if (!body.includes(FALLBACK_TEXT))
          failures.push(`${label}: no fallback message`)
        if (!/<meta name="robots" content="noindex"/.test(body))
          failures.push(`${label}: the fallback is not marked noindex`)
        if (!(response.headers.get('cache-control') ?? '').includes('no-store'))
          failures.push(
            `${label}: Cache-Control is "${response.headers.get('cache-control')}"`
          )
      }
      if (behaviour === 'error') continue
      for (const name of ENGINES) {
        const run = browserRun++
        const browser = await (name === 'webkit' ? webkit : chromium).launch()
        try {
          for (const { path } of PAGES) {
            const context = await browser.newContext({
              viewport: { width: 375, height: 812 },
              javaScriptEnabled: false,
            })
            const page = await context.newPage()
            const label = `${behaviour} backend, ${name}, javascript off, ${path}`
            const loaded = await page
              .goto(BASE_URL + coldPath(path, run), {
                waitUntil: 'load',
                timeout: boundFor(2) + 5000,
              })
              .then(
                () => true,
                () => false
              )
            const missing = loaded
              ? await readableWithoutScripts(page)
              : ['the page did not load']
            console.log(
              `${label.padEnd(56)} ${missing.length ? 'FAILS' : 'reads'}`
            )
            for (const what of missing) failures.push(`${label}: ${what}`)
            await context.close()
          }
        } finally {
          await browser.close()
        }
      }
    }

    // The backend answers again: no page may serve a cached fallback.
    fixtureBackendBehaviour.mode = 'normal'
    // Let reads that finished after their page gave up settle into the cache.
    await new Promise((r) => setTimeout(r, PUBLIC_READ_TIMEOUT_MS))
    for (const { path, content } of PAGES) {
      const { response, body } = await timedFetch(path, 10_000)
      const label = `answering backend, ${path}`
      const ok = body.includes(content) && !body.includes(FALLBACK_TEXT)
      console.log(
        `${label.padEnd(56)} ${response.status}  ${ok ? 'content' : 'FALLBACK'}`
      )
      if (!ok) failures.push(`${label}: shows the fallback, not its content`)
    }
  } finally {
    app?.kill()
    backend.closeAllConnections()
    backend.close()
  }
  if (failures.length > 0) {
    console.error(
      `\nSlow-backend reading check failed:\n- ${failures.join('\n- ')}`
    )
    process.exit(1)
  }
  console.log('\nSlow-backend reading check passed.')
  process.exit(0)
}

if (import.meta.main) await main()
