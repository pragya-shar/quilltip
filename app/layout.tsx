import type { Metadata } from 'next'
import './globals.css'
import './highlights.css'
import Providers from '@/components/providers/Providers'
import { Analytics } from '@vercel/analytics/react'
import { SITE_META_DESCRIPTION } from '@/lib/copy/landing-sections'
import { SITE_NAME, SITE_ORIGIN } from '@/lib/seo/siteMetadata'

export const metadata: Metadata = {
  metadataBase: new URL(SITE_ORIGIN),
  title: `${SITE_NAME} - Decentralized Publishing Platform`,
  description: SITE_META_DESCRIPTION,
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* Syne 600 is the one face every page uses above the fold. Pages
            preload their other first-screen faces themselves (lib/fonts/preloadFonts.ts). */}
        <link
          rel="preload"
          href="/landing/fonts/syne-latin-600-normal.woff2"
          as="font"
          type="font/woff2"
          crossOrigin="anonymous"
        />
      </head>
      <body className="font-sans antialiased bg-background text-foreground">
        <Providers>{children}</Providers>
        <Analytics />
      </body>
    </html>
  )
}
