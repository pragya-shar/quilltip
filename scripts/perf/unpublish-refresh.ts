// An article that leaves its public address leaves the page at once (#613).
// The article page reuses a server copy of a published article for up to 60 s
// (lib/seo/publicContent.ts); the copy is used only while the article's
// version still matches. Runs against the fixture build of perf:budget and
// edits the fixture while the app runs; needs no secrets.
//
//   NEXT_PUBLIC_CONVEX_URL=http://127.0.0.1:3299 bun run build
//   bun run perf:unpublish-refresh
//
// Each article is first loaded twice, so its copy is cached and the proxy has
// seen it. Then, well inside the cache time, on a full page load and on a
// client navigation (an RSC request, which skips the proxy's check):
// - unpublished: 404 (the navigation does not answer 200) and no article text;
// - republished: the article again, at once;
// - deleted and its slug taken by another article: only the new text;
// - the writer changed handle: the old article and writer addresses
//   redirect, with no article text;
// - a draft: 404 and no draft text.
// A client cannot send the proxy's answer itself, and pages of a writer whose
// handle starts with "api" go through the proxy too.

import { rmSync } from 'fs'
import { join } from 'path'
import {
  FIXTURE_DRAFT,
  FIXTURE_WRITER,
  fixtureArticlePath,
  fixtureArticleVersion,
  replaceFixtureArticle,
  setFixtureArticlePublished,
  setFixtureWriterHandle,
} from './convex-fixture'
import { ARTICLE_ROUTE_HEADER } from '../../lib/seo/articleRoute'
import { PUBLIC_READ_TIMEOUT_MS } from '../../lib/seo/publicReadTimeout'
import { fixtureBackendBehaviour, startFixtureBackend } from './fixture-backend'
import { startProductionApp } from './production-app'
import { READING } from './no-script-reading'

const CONVEX_PORT = Number(process.env.PERF_CONVEX_PORT ?? 3299)
const APP_PORT = Number(process.env.PERF_APP_PORT ?? 3199)
const BASE_URL = `http://127.0.0.1:${APP_PORT}`
/** The cache time in lib/seo/publicContent.ts. */
const CACHE_SECONDS = 60

const PROSE = READING.prose
const NEW_TEXT = 'A different article now lives at this address.'
const RENAMED = `${FIXTURE_WRITER}-renamed`
const FALLBACK_TEXT = 'could not be loaded right now'
/** Two reads in sequence (the route check, then the article), plus a margin. */
const TROUBLE_BOUND_MS = 2 * PUBLIC_READ_TIMEOUT_MS + 1000

type Load = 'page' | 'navigation'

async function load(
  path: string,
  kind: Load,
  extraHeaders: Record<string, string> = {}
) {
  const get = (url: string) =>
    fetch(new URL(url, BASE_URL), {
      redirect: 'manual',
      // A client navigation asks for the page's RSC payload, not its HTML.
      headers: {
        ...(kind === 'navigation' ? { RSC: '1' } : {}),
        ...extraHeaders,
      },
      signal: AbortSignal.timeout(15_000),
    })
  const startedAt = performance.now()
  let response = await get(path)
  // Next.js first sends an RSC request without its cache key to the same path
  // with one; the browser follows that redirect.
  const location = response.headers.get('location') ?? ''
  if (kind === 'navigation' && response.status === 307) {
    const next = new URL(location, BASE_URL)
    if (next.pathname === path && next.searchParams.has('_rsc'))
      response = await get(next.pathname + next.search)
  }
  const body = await response.text()
  return {
    status: response.status,
    body,
    response,
    ms: performance.now() - startedAt,
  }
}

const failures: string[] = []
let started = 0

async function expectLoad(
  label: string,
  path: string,
  kind: Load,
  expect: {
    status?: number
    notStatus?: number
    has?: string[]
    lacks?: string[]
    location?: string
    /** The proxy ran: the response carries its security policy. */
    csp?: boolean
    headers?: Record<string, string>
    /** Longest the whole answer may take. */
    maxMs?: number
  }
) {
  const { status, body, response, ms } = await load(path, kind, expect.headers)
  const problems: string[] = []
  if (expect.status !== undefined && status !== expect.status)
    problems.push(`status ${status}, expected ${expect.status}`)
  if (expect.notStatus !== undefined && status === expect.notStatus)
    problems.push(`status ${status}`)
  for (const text of expect.has ?? [])
    if (!body.includes(text)) problems.push(`no "${text}"`)
  for (const text of expect.lacks ?? [])
    if (body.includes(text)) problems.push(`still has "${text}"`)
  if (expect.location !== undefined) {
    const location = response.headers.get('location') ?? ''
    if (!location.endsWith(expect.location))
      problems.push(`location "${location}", expected ${expect.location}`)
  }
  if (expect.maxMs !== undefined && ms > expect.maxMs)
    problems.push(`took ${Math.round(ms)} ms, limit ${expect.maxMs} ms`)
  if (expect.csp && !response.headers.get('content-security-policy'))
    problems.push('no Content-Security-Policy header: the proxy did not run')
  const seconds = ((Date.now() - started) / 1000).toFixed(1)
  console.log(
    `${`${label}, ${kind}`.padEnd(58)} t=${seconds.padStart(4)} s  ${status}  ${problems.length ? 'FAILS' : 'ok'}`
  )
  for (const problem of problems) failures.push(`${label}, ${kind}: ${problem}`)
}

/** Loads a published article twice, so its copy is cached. */
async function warm(label: string, path: string) {
  for (let i = 0; i < 2; i++)
    await expectLoad(`${label}, published`, path, 'page', {
      status: 200,
      has: [PROSE],
    })
}

async function main() {
  // Start from an empty data cache, so the first loads fill it.
  rmSync(join(process.cwd(), '.next', 'cache', 'fetch-cache'), {
    recursive: true,
    force: true,
  })
  const backend = startFixtureBackend(CONVEX_PORT)
  const app = await startProductionApp(APP_PORT, BASE_URL)
  started = Date.now()
  try {
    // Unpublished, then published again.
    const hidden = fixtureArticlePath(4)
    await warm('unpublish', hidden)
    const other = fixtureArticlePath(7)
    await warm('other article', other)
    const publishedVersion = fixtureArticleVersion('fixture-article-4')
    setFixtureArticlePublished('fixture-article-4', false)
    for (const kind of ['page', 'navigation'] as const)
      await expectLoad('unpublished', hidden, kind, {
        ...(kind === 'page' ? { status: 404 } : { notStatus: 200 }),
        lacks: [PROSE],
      })
    // A client cannot hand the page the proxy's answer: not the version the
    // page cached before the unpublish, and not another article's.
    const forged = {
      'its old version': `found ${publishedVersion}`,
      "another article's version": `found ${fixtureArticleVersion('fixture-article-7')}`,
    }
    for (const [name, value] of Object.entries(forged))
      for (const kind of ['page', 'navigation'] as const)
        await expectLoad(`unpublished, sent ${name}`, hidden, kind, {
          ...(kind === 'page' ? { status: 404 } : { notStatus: 200 }),
          lacks: [PROSE],
          headers: { [ARTICLE_ROUTE_HEADER]: value },
        })

    // The backend stops answering. No copy of unknown freshness is served:
    // the hidden article does not come back, and a cached published one shows
    // the readable fallback too, within the read limits.
    fixtureBackendBehaviour.mode = 'silent'
    for (const [name, path] of [
      ['unpublished', hidden],
      ['published and cached', other],
    ] as const)
      for (const kind of ['page', 'navigation'] as const)
        await expectLoad(`silent backend, ${name}`, path, kind, {
          status: 200,
          has: [FALLBACK_TEXT],
          lacks: [PROSE],
          maxMs: TROUBLE_BOUND_MS,
        })
    fixtureBackendBehaviour.mode = 'normal'
    setFixtureArticlePublished('fixture-article-4', true)
    for (const kind of ['page', 'navigation'] as const)
      await expectLoad('republished', hidden, kind, {
        status: 200,
        has: [PROSE],
      })

    // Deleted, and the slug taken by another article.
    const replaced = fixtureArticlePath(5)
    await warm('replace', replaced)
    replaceFixtureArticle('fixture-article-5', NEW_TEXT)
    for (const kind of ['page', 'navigation'] as const)
      await expectLoad('slug taken by another article', replaced, kind, {
        status: 200,
        has: [NEW_TEXT],
        lacks: [PROSE],
      })

    // The writer changed handle: the old addresses redirect. The proxy
    // reuses a "found" answer for a writer page, and the page then redirects
    // itself.
    const moved = fixtureArticlePath(6)
    await warm('handle change', moved)
    for (let i = 0; i < 2; i++)
      await expectLoad('handle change, writer page', READING.writer, 'page', {
        status: 200,
      })
    setFixtureWriterHandle(RENAMED)
    await expectLoad('handle changed, writer page', READING.writer, 'page', {
      status: 307,
      location: `/${RENAMED}`,
    })
    await expectLoad('handle changed', moved, 'page', {
      status: 307,
      location: `/${RENAMED}/fixture-article-6`,
      lacks: [PROSE],
    })
    // The navigation's redirect is inside the payload; only the text counts.
    await expectLoad('handle changed', moved, 'navigation', {
      lacks: [PROSE],
    })
    setFixtureWriterHandle(FIXTURE_WRITER)

    // A writer whose handle starts with "api" gets the proxy too.
    await expectLoad(
      'handle starting with api',
      '/apiwriter/an-article',
      'page',
      {
        status: 404,
        csp: true,
      }
    )

    // A draft never appears.
    for (const kind of ['page', 'navigation'] as const)
      await expectLoad('draft', READING.draft.path, kind, {
        ...(kind === 'page' ? { status: 404 } : { notStatus: 200 }),
        lacks: [FIXTURE_DRAFT.text],
      })

    const elapsed = (Date.now() - started) / 1000
    if (elapsed >= CACHE_SECONDS)
      failures.push(
        `the checks took ${elapsed.toFixed(1)} s, longer than the ${CACHE_SECONDS} s cache time, so they prove nothing`
      )
  } finally {
    app?.kill()
    backend.closeAllConnections()
    backend.close()
  }
  if (failures.length > 0) {
    console.error(`\nUnpublish check failed:\n- ${failures.join('\n- ')}`)
    process.exit(1)
  }
  console.log('\nArticles that leave their address leave the page at once.')
}

if (import.meta.main) await main()
