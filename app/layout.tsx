import type { Metadata } from 'next'
import './globals.css'
import './highlights.css'
import Providers from '@/components/providers/Providers'
import { Analytics } from '@vercel/analytics/react'
import { AnalyticsConsent } from '@/components/analytics/AnalyticsConsent'
import { ANALYTICS_ENABLED } from '@/lib/analytics/config'
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
        <link
          rel="preload"
          href="/landing/fonts/work-sans-latin-400-normal.woff2"
          as="font"
          type="font/woff2"
          crossOrigin="anonymous"
        />
        <link
          rel="preload"
          href="/account/fonts/syne-variable.woff2"
          as="font"
          type="font/woff2"
          crossOrigin="anonymous"
        />
      </head>
      <body className="font-sans antialiased bg-background text-foreground">
        <Providers>{children}</Providers>
        <Analytics />
        {ANALYTICS_ENABLED && <AnalyticsConsent />}
      </body>
    </html>
  )
}
