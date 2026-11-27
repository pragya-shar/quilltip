import type { Metadata } from 'next'
import { headers } from 'next/headers'
import './globals.css'
import Providers from '@/components/providers/Providers'
import { Analytics } from '@vercel/analytics/react'
import { AnalyticsConsent } from '@/components/analytics/AnalyticsConsent'
import { EarlyMenuScript } from '@/components/layout/EarlyMenuScript'
import { analyticsServerKey } from '@/lib/analytics/config'
import { NONCE_HEADER } from '@/lib/security/contentSecurityPolicy'
import { SITE_META_DESCRIPTION } from '@/lib/copy/landing-sections'
import { SITE_NAME, SITE_ORIGIN } from '@/lib/seo/siteMetadata'

export const metadata: Metadata = {
  metadataBase: new URL(SITE_ORIGIN),
  title: `${SITE_NAME} - Decentralized Publishing Platform`,
  description: SITE_META_DESCRIPTION,
}

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  // Reading the request renders every page per request. Next.js adds the CSP
  // nonce from proxy.ts to its scripts only while rendering, so a prerendered
  // page would carry scripts the policy blocks. The theme script needs the
  // same nonce, as do the early-menu and early-submit scripts. See
  // docs/security/content-security-policy.md.
  const nonce = (await headers()).get(NONCE_HEADER) ?? undefined
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
        {/* Keeps focus out of the page behind the mobile menu before the
            page scripts run. Not in <head>: an inline script there changes
            when Chrome runs the page's chunks (first paint about 0.9 s
            earlier, React about 0.9 s later on the slow phone profile;
            issue #554). */}
        <EarlyMenuScript nonce={nonce} />
        <Providers nonce={nonce}>{children}</Providers>
        <Analytics />
        {analyticsServerKey() && <AnalyticsConsent />}
      </body>
    </html>
  )
}
