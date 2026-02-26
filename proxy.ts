import { NextRequest, NextResponse } from 'next/server'

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl
  const response = NextResponse.next()

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
    const csp = [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob: *.convex.cloud *.convex.site img.youtube.com images.unsplash.com plus.unsplash.com arweave.net",
      "connect-src 'self' *.convex.cloud wss://*.convex.cloud *.convex.site wss://*.convex.site *.stellar.org arweave.net ar-io.dev",
      "font-src 'self'",
      "frame-src 'self' www.youtube.com",
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
