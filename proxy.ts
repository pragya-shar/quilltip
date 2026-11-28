import { NextRequest, NextResponse } from 'next/server'
import { api } from '@/convex/_generated/api'
import { publicContentPath } from '@/lib/routing/publicContentPath'
import {
  buildContentSecurityPolicy,
  createNonce,
  NONCE_HEADER,
} from '@/lib/security/contentSecurityPolicy'
import { PUBLIC_READ_TIMEOUT_MS } from '@/lib/seo/publicReadTimeout'
import {
  ARTICLE_ROUTE_HEADER,
  formatArticleRoute,
  formatWriterRoute,
} from '@/lib/seo/articleRoute'
import { publicQuery } from '@/lib/seo/publicQuery'
import { readingListState } from '@/lib/seo/readingListState'
import {
  READ_DEADLINE_HEADER,
  REQUEST_READ_BUDGET_MS,
  formatReadDeadline,
} from '@/lib/seo/readDeadline'
import {
  OUTAGE_RETRY_AFTER_SECONDS,
  outageBodyFor,
  outageContentSecurityPolicy,
  outagePathKind,
} from '@/lib/outage/outageBody'

const ROUTE_CHECK_TIMEOUT_MS = PUBLIC_READ_TIMEOUT_MS

// A writer page's name and article titles repaint when these typefaces arrive,
// which sets the largest paint on slow phones. The stylesheet only reveals them
// after the content renders, so send them with the response, before the HTML
// is parsed.
const WRITER_PAGE_FONT_PRELOADS = [
  '</prototype/fonts/library-syne.woff2>; rel=preload; as=font; type="font/woff2"; crossorigin',
  '</prototype/fonts/library-alegreya.woff2>; rel=preload; as=font; type="font/woff2"; crossorigin',
].join(', ')

// Profile settings and new-writer setup lay out in this typeface once the
// signed-in content renders. Fetching it with the response keeps the headings
// from reflowing when it arrives.
const ACCOUNT_FONT_PRELOAD =
  '</account/fonts/syne-variable.woff2>; rel=preload; as=font; type="font/woff2"; crossorigin'
const ACCOUNT_FONT_PATHS = new Set(['/settings', '/welcome'])

type RouteCheck =
  | { kind: 'found'; version?: string }
  | { kind: 'missing' }
  | { kind: 'moved'; username: string }
  // /articles: the backend answered its list state.
  | { kind: 'list' }
  // The check failed twice, or an outage was declared within the last 5 s.
  | { kind: 'outage' }

/**
 * Outage memory, per server instance (#609). Once a check has failed twice,
 * every public reading request answers 503 at once, with no backend read,
 * until this time. The proxy cannot tell a prefetch from a document load
 * (Next.js removes the flight headers before it runs), so this bounds an
 * outage to one two-limit check per 5 s however many links are prefetched.
 *
 * Only a twice-failed check sets it; a 503 served from it never renews it.
 * After it expires the next request checks again, and the first good answer
 * ends the outage. The cost: one check that fails twice on one path makes
 * this instance answer 503 on every checked path for up to 5 s. The 503
 * response itself is `no-store`.
 */
const OUTAGE_MEMORY_MS = 5000
let outageUntil = 0

const FAILED = Symbol('failed')

/** One read, or FAILED when it errors or runs out of time (and is aborted). */
async function attempt<T>(read: () => Promise<T>): Promise<T | typeof FAILED> {
  try {
    return await read()
  } catch {
    return FAILED
  }
}

/**
 * The proxy's own check, retried once: a single slow or failed query against
 * a healthy backend still gives the page. Two failures declare the outage.
 * The retry touches only this check, never the page's reads.
 */
async function checkWithRetry<T>(
  read: () => Promise<T>
): Promise<T | typeof FAILED> {
  const first = await attempt(read)
  if (first !== FAILED) return first
  const second = await attempt(read)
  if (second === FAILED) outageUntil = Date.now() + OUTAGE_MEMORY_MS
  return second
}

/**
 * Check `/articles`, writer and article URLs before the page renders, so a
 * missing one answers 404, an earlier handle redirects, and an unreachable
 * backend answers 503 (#609). (These pages once streamed behind a root
 * loading boundary that fixed the status at 200; they no longer do, #428.)
 * Every full load of these pages makes one backend read here; `/` makes none.
 */
/**
 * Recent "found" answers for writer pages, per server instance. A found writer
 * page renders normally and reads the writer itself, so reusing the answer
 * briefly only skips a backend round trip before the HTML starts. Missing and
 * moved answers are never reused, so handle changes take effect at once.
 *
 * Article pages always ask: the answer carries the article's version, which
 * decides whether the page may use its cached copy, so an article that was
 * unpublished, deleted or replaced leaves the page at once.
 */
const FOUND_TTL_MS = 60_000
const FOUND_CACHE_LIMIT = 500
const recentlyFound = new Map<string, number>()

function foundKey(target: { username: string; slug?: string }) {
  return `${target.username}\u0000${target.slug ?? ''}`
}

function wasRecentlyFound(key: string) {
  const expires = recentlyFound.get(key)
  if (expires === undefined) return false
  if (expires > Date.now()) return true
  recentlyFound.delete(key)
  return false
}

function rememberFound(key: string) {
  if (recentlyFound.size >= FOUND_CACHE_LIMIT) {
    // Maps keep insertion order: drop the oldest entry.
    const oldest = recentlyFound.keys().next().value
    if (oldest !== undefined) recentlyFound.delete(oldest)
  }
  recentlyFound.set(key, Date.now() + FOUND_TTL_MS)
}

async function checkPublicContent(
  request: NextRequest
): Promise<RouteCheck | null> {
  const pathKind = outagePathKind(request.nextUrl.pathname)
  if (!pathKind) return null
  // A declared outage answers every public reading path at once, writer
  // pages inside their "found" window included.
  if (Date.now() < outageUntil) return { kind: 'outage' }
  // Only full page loads carry a status that crawlers read; this skip is meant
  // for client navigations and link prefetches (RSC requests). Under
  // `next start`, Next.js removes the RSC header before the proxy runs
  // (next/dist/server/web/adapter.js), so those are checked as well.
  if (request.headers.get('rsc') === '1') return null

  if (pathKind === 'articles') {
    const state = await checkWithRetry(() =>
      readingListState(ROUTE_CHECK_TIMEOUT_MS)
    )
    return state === FAILED ? { kind: 'outage' } : { kind: 'list' }
  }

  const target = publicContentPath(request.nextUrl.pathname)
  if (!target) return null
  const key = target.slug === undefined ? foundKey(target) : null
  if (key && wasRecentlyFound(key)) return { kind: 'found' }

  const check = await checkWithRetry(() =>
    publicQuery(
      ROUTE_CHECK_TIMEOUT_MS,
      api.publicRoutes.resolvePublicRoute,
      target
    )
  )
  if (check === FAILED) return { kind: 'outage' }
  if (key && check.kind === 'found') rememberFound(key)
  return check
}

/** Headers every response gets, the outage response included. */
function setSecurityHeaders(response: NextResponse, csp: string | null) {
  response.headers.set('X-Frame-Options', 'DENY')
  response.headers.set('X-Content-Type-Options', 'nosniff')
  response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin')
  response.headers.set('X-XSS-Protection', '1; mode=block')
  response.headers.set(
    'Permissions-Policy',
    'camera=(), microphone=(), geolocation=()'
  )
  if (csp) response.headers.set('Content-Security-Policy', csp)
  // HSTS only in production
  if (process.env.NODE_ENV === 'production') {
    response.headers.set(
      'Strict-Transport-Security',
      'max-age=31536000; includeSubDomains; preload'
    )
  }
}

/**
 * The outage response (#609): 503, `Retry-After`, `no-store`, and the body of
 * the path's root layout, with its own policy (only its nonce'd style
 * loads). A HEAD request gets the same headers and no body.
 */
function outageResponse(
  request: NextRequest,
  outage: NonNullable<ReturnType<typeof outageBodyFor>>,
  nonce: string
): NextResponse {
  const body =
    request.method === 'HEAD'
      ? null
      : outage.body(outage.kind, new URL(request.url), nonce)
  const response = new NextResponse(body, {
    status: 503,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Retry-After': String(OUTAGE_RETRY_AFTER_SECONDS),
      'Cache-Control': 'no-store',
    },
  })
  setSecurityHeaders(response, outageContentSecurityPolicy(nonce))
  return response
}

function movedUrl(request: NextRequest, username: string) {
  const url = request.nextUrl.clone()
  const target = publicContentPath(url.pathname)
  url.pathname = target?.slug
    ? `/${encodeURIComponent(username)}/${encodeURIComponent(target.slug)}`
    : `/${encodeURIComponent(username)}`
  return url
}

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl
  const startedAt = Date.now()
  const check = await checkPublicContent(request)

  // Production pages get a per-request nonce. Next.js reads it from the
  // request's CSP header and adds it to every script it renders, so the
  // policy needs no 'unsafe-inline'. Development keeps no policy, because
  // Fast Refresh evaluates code at run time.
  const nonce = createNonce()
  const csp =
    process.env.NODE_ENV === 'production'
      ? buildContentSecurityPolicy(nonce, {
          NEXT_PUBLIC_CONVEX_URL: process.env.NEXT_PUBLIC_CONVEX_URL,
          NEXT_PUBLIC_HORIZON_URL: process.env.NEXT_PUBLIC_HORIZON_URL,
          NEXT_PUBLIC_SOROBAN_RPC_URL: process.env.NEXT_PUBLIC_SOROBAN_RPC_URL,
          NEXT_PUBLIC_STELLAR_RPC_URL: process.env.NEXT_PUBLIC_STELLAR_RPC_URL,
          NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID:
            process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID,
          VERCEL_ENV: process.env.VERCEL_ENV,
        })
      : null

  if (check?.kind === 'outage') {
    const outage = outageBodyFor(pathname)
    if (outage) return outageResponse(request, outage, nonce)
  }

  const requestHeaders = new Headers(request.headers)
  // Only the proxy's own answer may reach the article page: a copy the client
  // sent is removed on every request. A request that arrives marked as RSC
  // is not checked above, so it carries no answer and the page asks itself.
  requestHeaders.delete(ARTICLE_ROUTE_HEADER)
  requestHeaders.delete(READ_DEADLINE_HEADER)
  const target = publicContentPath(pathname)
  if (target && request.headers.get('rsc') !== '1') {
    const answer =
      check?.kind === 'found' || check?.kind === 'missing'
        ? check
        : ({ kind: 'unknown' } as const)
    requestHeaders.set(
      ARTICLE_ROUTE_HEADER,
      target.slug !== undefined
        ? formatArticleRoute(answer)
        : formatWriterRoute({ kind: answer.kind })
    )
  }
  // The page's reads get only what is left of the request's budget (#609).
  if (check) {
    requestHeaders.set(
      READ_DEADLINE_HEADER,
      formatReadDeadline(startedAt + REQUEST_READ_BUDGET_MS)
    )
  }
  if (csp) {
    requestHeaders.set('Content-Security-Policy', csp)
    // Server components read the nonce here for scripts Next.js does not
    // render itself (the theme script).
    requestHeaders.set(NONCE_HEADER, nonce)
  }

  // Missing: the page still renders its not-found screen; only the status
  // changes. Moved: a temporary redirect to the writer's current handle.
  // Writers can switch back to an earlier handle, so browsers must not cache
  // the redirect (a cached Alice -> Bob would loop once Alice is current).
  const response =
    check?.kind === 'missing'
      ? NextResponse.rewrite(request.nextUrl, {
          status: 404,
          request: { headers: requestHeaders },
        })
      : check?.kind === 'moved'
        ? NextResponse.redirect(movedUrl(request, check.username), 307)
        : NextResponse.next({ request: { headers: requestHeaders } })

  if (check?.kind === 'moved') {
    response.headers.set('Cache-Control', 'no-store')
  }
  if (check?.kind === 'found' && !publicContentPath(pathname)?.slug) {
    response.headers.append('Link', WRITER_PAGE_FONT_PRELOADS)
  }
  if (ACCOUNT_FONT_PATHS.has(pathname) && request.headers.get('rsc') !== '1') {
    response.headers.append('Link', ACCOUNT_FONT_PRELOAD)
  }

  // Security headers (apply to all routes)
  setSecurityHeaders(response, csp)

  // Handle dynamic article routes with additional headers
  if (pathname.match(/^\/[^\/]+\/[^\/]+$/)) {
    // Add headers to improve RSC streaming reliability
    response.headers.set(
      'Cache-Control',
      'no-cache, no-store, max-age=0, must-revalidate'
    )
    response.headers.set('X-Accel-Buffering', 'no') // Disable nginx buffering
  }

  return response
}

export const config = {
  matcher: [
    /*
     * Match all request paths except:
     * - /api and /api/... (API routes). Only that segment: a writer's handle
     *   may start with "api" (/apiary/...), and writer pages need the
     *   proxy's headers and checks.
     * - /_next/static/... and /_next/image... (static files and the image
     *   optimizer; handles cannot start with "_").
     * - /favicon.ico exactly (the dot is escaped, so no other path matches).
     * Matching is case-sensitive, as routing is: /API/x is a writer page.
     * scripts/perf/proxy-matcher.test.ts compiles this list as Next.js does.
     */
    '/((?!api(?:/|$)|_next/static|_next/image|favicon\\.ico$).*)',
  ],
}
