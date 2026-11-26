import { NextRequest, NextResponse } from 'next/server'
import { fetchQuery } from 'convex/nextjs'
import { api } from '@/convex/_generated/api'
import { publicContentPath } from '@/lib/routing/publicContentPath'
import {
  buildContentSecurityPolicy,
  createNonce,
  NONCE_HEADER,
} from '@/lib/security/contentSecurityPolicy'

const ROUTE_CHECK_TIMEOUT_MS = 1500

// A writer page's name and article titles repaint when these typefaces arrive,
// which sets the largest paint on slow phones. The stylesheet only reveals them
// after the content renders, and app/loading.tsx keeps a page's own preload
// hints out of the HTML head, so send them with the response instead.
const WRITER_PAGE_FONT_PRELOADS = [
  '</prototype/fonts/library-syne.woff2>; rel=preload; as=font; type="font/woff2"; crossorigin',
  '</prototype/fonts/library-alegreya.woff>; rel=preload; as=font; type="font/woff"; crossorigin',
].join(', ')

// Profile settings and new-writer setup lay out in this typeface once the
// signed-in content renders. Fetching it with the response keeps the headings
// from reflowing when it arrives.
const ACCOUNT_FONT_PRELOAD =
  '</account/fonts/syne-variable.woff2>; rel=preload; as=font; type="font/woff2"; crossorigin'
const ACCOUNT_FONT_PATHS = new Set(['/settings', '/welcome'])

type RouteCheck =
  | { kind: 'found' }
  | { kind: 'missing' }
  | { kind: 'moved'; username: string }

/**
 * Pages stream behind app/loading.tsx, which fixes the status at 200 before
 * they can call notFound(). Check writer and article URLs here instead, so a
 * missing one answers 404 and an earlier handle redirects. Any failure lets
 * the request through unchanged.
 */
/**
 * Recent "found" answers, per server instance. A found writer or article page
 * renders normally, so reusing the answer briefly only skips a backend round
 * trip before the HTML starts. Missing and moved answers are never reused, so
 * new articles and handle changes take effect at once.
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
  // Only full page loads carry a status that crawlers read. Client navigations
  // and link prefetches (RSC requests) skip the extra backend call.
  if (request.headers.get('rsc') === '1') return null
  const target = publicContentPath(request.nextUrl.pathname)
  if (!target) return null
  const key = foundKey(target)
  if (wasRecentlyFound(key)) return { kind: 'found' }

  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    const check = await Promise.race([
      fetchQuery(api.publicRoutes.resolvePublicRoute, target),
      new Promise<null>((resolve) => {
        timer = setTimeout(() => resolve(null), ROUTE_CHECK_TIMEOUT_MS)
      }),
    ])
    if (check?.kind === 'found') rememberFound(key)
    return check
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
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
          VERCEL_ENV: process.env.VERCEL_ENV,
        })
      : null
  const requestHeaders = new Headers(request.headers)
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
     * Match all request paths except for the ones starting with:
     * - api (API routes)
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     */
    '/((?!api|_next/static|_next/image|favicon.ico).*)',
  ],
}
