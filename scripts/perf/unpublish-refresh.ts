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
// client navigation (an RSC request):
// - unpublished: 404 (the navigation does not answer 200) and no article text;
// - republished: the article again, at once;
// - deleted and its slug taken by another article: only the new text;
// - the writer changed handle: the old article and writer addresses
//   redirect, with no article text;
// - a draft: 404 and no draft text.
// With the backend silent, or only its route check late, the proxy answers
// the 503 outage state (#609). When the route check answers wrongly (a
// function that threw), the page reads the article directly and never uses
// a cached copy, so a hidden article never comes back.
// A client cannot send the proxy's answer itself, and pages of a writer whose
// handle starts with "api" go through the proxy too (#623); /api does not.

import { rmSync } from 'fs'
import { join } from 'path'
import {
  FIXTURE_DRAFT,
  FIXTURE_SLUG,
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
/** proxy.ts: how long one instance remembers a declared outage (#609). */
const OUTAGE_MEMORY_MS = 5000

type Load = 'page' | 'navigation'

async function load(
  path: string,
  kind: Load,
  extraHeaders: Record<string, string> = {}
) {
  // A client navigation asks for the page's RSC payload, not its HTML, with
  // the cache-key parameter a browser sends.
  const url =
    kind === 'navigation'
      ? `${path}${path.includes('?') ? '&' : '?'}_rsc`
      : path
  const startedAt = performance.now()
  const response = await fetch(new URL(url, BASE_URL), {
    redirect: 'manual',
    headers: {
      ...(kind === 'navigation' ? { RSC: '1' } : {}),
      ...extraHeaders,
    },
    signal: AbortSignal.timeout(15_000),
  })
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
    /** Whether the proxy ran: only its responses carry the security policy. */
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
  const policy = response.headers.get('content-security-policy')
  if (expect.csp === true && !policy)
    problems.push('no Content-Security-Policy header: the proxy did not run')
  if (expect.csp === false && policy)
    problems.push('a Content-Security-Policy header: the proxy ran')
  const seconds = ((Date.now() - started) / 1000).toFixed(1)
  console.log(
    `${`${label}, ${kind}`.padEnd(58)} t=${seconds.padStart(4)} s  ${status}  ${problems.length ? 'FAILS' : 'ok'}`
  )
  for (const problem of problems) failures.push(`${label}, ${kind}: ${problem}`)
}

/** Only the route check is slow: the proxy gives up on it, the rest answers. */
function slowRouteCheck(on: boolean) {
  Object.assign(
    fixtureBackendBehaviour,
    on
      ? {
          mode: 'slow',
          delayMs: PUBLIC_READ_TIMEOUT_MS * 2,
          slowPaths: ['publicRoutes:resolvePublicRoute'],
        }
      : { mode: 'normal', delayMs: 0, slowPaths: undefined }
  )
}

/**
 * Only the route check answers wrongly (a function that threw): no outage;
 * the proxy passes "unknown" and the page reads for itself (#609).
 */
function wrongRouteCheck(on: boolean) {
  Object.assign(
    fixtureBackendBehaviour,
    on
      ? { mode: 'wrong', wrongPaths: ['publicRoutes:resolvePublicRoute'] }
      : { mode: 'normal', wrongPaths: undefined }
  )
}

/** Ends an outage: the backend answers and the proxy's memory expires. */
async function afterOutage() {
  slowRouteCheck(false)
  fixtureBackendBehaviour.mode = 'normal'
  await new Promise((r) => setTimeout(r, OUTAGE_MEMORY_MS + 200))
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

    // The backend stops answering: the proxy answers the 503 outage state
    // before any page renders (#609), for a page load and a navigation alike
    // (Next.js removes the RSC header before the proxy runs). No copy of
    // unknown freshness is served: the hidden article does not come back,
    // and a cached published one shows the outage state too.
    fixtureBackendBehaviour.mode = 'silent'
    for (const [name, path] of [
      ['unpublished', hidden],
      ['published and cached', other],
    ] as const)
      for (const kind of ['page', 'navigation'] as const)
        await expectLoad(`silent backend, ${name}`, path, kind, {
          status: 503,
          has: [FALLBACK_TEXT],
          lacks: [PROSE],
          maxMs: TROUBLE_BOUND_MS,
        })
    await afterOutage()

    // Only the route check is late, twice: the proxy declares an outage, so
    // the published article is not served from its copy either.
    slowRouteCheck(true)
    await expectLoad('slow route check, published', other, 'page', {
      status: 503,
      lacks: [PROSE],
      maxMs: TROUBLE_BOUND_MS,
    })
    await afterOutage()

    // Only the route check answers wrongly: the page reads directly, so a
    // published article still shows, and the hidden one shows no text. Its
    // moved-handle lookup answers wrongly too, so the page shows its
    // readable fallback rather than a 404 (#609).
    wrongRouteCheck(true)
    await expectLoad('route check answers wrongly, published', other, 'page', {
      status: 200,
      has: [PROSE],
      maxMs: TROUBLE_BOUND_MS,
    })
    await expectLoad(
      'route check answers wrongly, unpublished',
      hidden,
      'page',
      {
        status: 200,
        has: [FALLBACK_TEXT],
        lacks: [PROSE],
        maxMs: TROUBLE_BOUND_MS,
      }
    )
    wrongRouteCheck(false)

    // One article read while the route check answers wrongly, then hidden. A
    // copy of that read is never used again: not while the check still
    // answers wrongly, and not once it answers. Each case on its own article, so a copy kept from
    // the first read would be the one asked for.
    const afterSlowRead = [
      ['the check still answering wrongly', 'fixture-article-9', 'page', true],
      [
        'the check still answering wrongly',
        'fixture-article-3',
        'navigation',
        true,
      ],
      ['the check answering', 'fixture-article-2', 'page', false],
      ['the check answering', FIXTURE_SLUG, 'navigation', false],
    ] as const
    for (const [when, slug, kind, stillWrong] of afterSlowRead) {
      const path = `/${FIXTURE_WRITER}/${slug}`
      wrongRouteCheck(true)
      await expectLoad(
        `route check answers wrongly, ${slug} published`,
        path,
        kind,
        {
          status: 200,
          has: [PROSE],
          maxMs: TROUBLE_BOUND_MS,
        }
      )
      setFixtureArticlePublished(slug, false)
      wrongRouteCheck(stillWrong)
      await expectLoad(`${slug} hidden, ${when}`, path, kind, {
        // Still wrong: the page cannot tell missing from moved, so it shows
        // its readable fallback (the payload carries it, rendered on the
        // server). Once
        // the check answers, the proxy says "missing": the not-found screen.
        ...(stillWrong
          ? kind === 'page'
            ? { status: 200, has: [FALLBACK_TEXT] }
            : { has: [FALLBACK_TEXT] }
          : kind === 'page'
            ? { status: 404 }
            : { has: ['NEXT_HTTP_ERROR_FALLBACK;404'] }),
        lacks: [PROSE],
        maxMs: TROUBLE_BOUND_MS + PUBLIC_READ_TIMEOUT_MS,
      })
      wrongRouteCheck(false)
      setFixtureArticlePublished(slug, true)
    }

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

    // A writer whose handle starts with "api" gets the proxy too (#623): its
    // security policy, its route check, and its removal of a client's route
    // header. /api itself does not.
    setFixtureWriterHandle('apiary')
    const apiary = '/apiary/fixture-article-8'
    await expectLoad('handle apiary, published', apiary, 'page', {
      status: 200,
      has: [PROSE],
      csp: true,
    })
    await expectLoad('handle apiary, no such article', '/apiary/x', 'page', {
      status: 404,
      csp: true,
    })
    const apiaryVersion = fixtureArticleVersion('fixture-article-8')
    setFixtureArticlePublished('fixture-article-8', false)
    for (const kind of ['page', 'navigation'] as const)
      await expectLoad(
        'handle apiary, unpublished, sent its old version',
        apiary,
        kind,
        {
          ...(kind === 'page'
            ? { status: 404, csp: true }
            : { notStatus: 200 }),
          lacks: [PROSE],
          headers: { [ARTICLE_ROUTE_HEADER]: `found ${apiaryVersion}` },
        }
      )
    setFixtureArticlePublished('fixture-article-8', true)
    setFixtureWriterHandle(FIXTURE_WRITER)
    // /api itself has no page or route: Next.js answers 404, without the
    // proxy. Routing is case-sensitive, so /API/x is a writer path.
    for (const path of ['/api', '/api/x'])
      await expectLoad(`API path ${path}`, path, 'page', {
        status: 404,
        csp: false,
      })
    for (const path of ['/api-docs', '/API/x'])
      await expectLoad(`writer path ${path}`, path, 'page', {
        status: 404,
        csp: true,
      })

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
