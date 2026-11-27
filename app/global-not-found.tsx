import type { Metadata } from 'next'
import { headers } from 'next/headers'
import './globals.css'
import Providers from '@/components/providers/Providers'
import { NONCE_HEADER } from '@/lib/security/contentSecurityPolicy'
import NotFound from './(legacy)/not-found'

// A URL that matches no route in either root layout. It keeps the pages'
// own 404 until the application shell has one of its own.
export const metadata: Metadata = {
  title: 'Page not found',
  robots: { index: false },
}

export default async function GlobalNotFound() {
  const nonce = (await headers()).get(NONCE_HEADER) ?? undefined
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="font-sans antialiased bg-background text-foreground">
        <Providers nonce={nonce}>
          <NotFound />
        </Providers>
      </body>
    </html>
  )
}
