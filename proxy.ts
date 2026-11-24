import { NextRequest, NextResponse } from 'next/server'
import { fetchQuery } from 'convex/nextjs'
import { api } from '@/convex/_generated/api'
import { publicContentPath } from '@/lib/routing/publicContentPath'

const ROUTE_CHECK_TIMEOUT_MS = 1500

/**
 * Pages stream behind app/loading.tsx, which fixes the status at 200 before
 * they can call notFound(). Check writer and article URLs here instead, so a
 * missing one answers 404. Any failure lets the request through unchanged.
 */
async function isMissingPublicContent(request: NextRequest): Promise<boolean> {
  // Only full page loads carry a status that crawlers read. Client navigations
  // and link prefetches (RSC requests) skip the extra backend call.
  if (request.headers.get('rsc') === '1') return false
  const target = publicContentPath(request.nextUrl.pathname)
  if (!target) return false

  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    const exists = await Promise.race([
      fetchQuery(api.publicRoutes.publicRouteExists, target),
      new Promise<null>((resolve) => {
        timer = setTimeout(() => resolve(null), ROUTE_CHECK_TIMEOUT_MS)
      }),
    ])
    return exists === false
  } catch {
    return false
  } finally {
    clearTimeout(timer)
  }
}

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl
  // The page still renders its not-found screen; only the status changes.
  const response = (await isMissingPublicContent(request))
    ? NextResponse.rewrite(request.nextUrl, { status: 404 })
    : NextResponse.next()

  // Security headers (apply to all routes)
  response.headers.set('X-Frame-Options', 'DENY')
  response.headers.set('X-Content-Type-Options', 'nosniff')
  response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin')
  response.headers.set('X-XSS-Protection', '1; mode=block')
  response.headers.set(
    'Permissions-Policy',
    'camera=(), microphone=(), geolocation=()'
  )

  // Content Security Policy (production only - dev needs full access for HMR/React)
  if (process.env.NODE_ENV === 'production') {
    // Vercel injects a feedback widget on preview deployments served from
    // vercel.live. Whitelist it on previews only so it doesn't widen the
    // production CSP attack surface.
    const isVercelPreview = process.env.VERCEL_ENV === 'preview'
    const scriptSrc = [
      "'self'",
      "'unsafe-inline'",
      ...(isVercelPreview ? ['https://vercel.live'] : []),
    ].join(' ')

    const csp = [
      "default-src 'self'",
      `script-src ${scriptSrc}`,
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob: *.convex.cloud *.convex.site img.youtube.com images.unsplash.com plus.unsplash.com arweave.net",
      // XLM price is now fetched server-side by a cron and cached in Convex;
      // the browser reads the cached row via api.xlmPrice.getCachedXlmPrice,
      // so there is no per-oracle host to allowlist here.
      "connect-src 'self' *.convex.cloud wss://*.convex.cloud *.convex.site wss://*.convex.site *.stellar.org arweave.net ar-io.dev",
      "font-src 'self'",
      "frame-src 'self' www.youtube.com www.youtube-nocookie.com",
      "frame-ancestors 'none'",
      "form-action 'self'",
      "base-uri 'self'",
    ].join('; ')
    response.headers.set('Content-Security-Policy', csp)
  }

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
