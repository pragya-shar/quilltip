import type { Metadata } from 'next'
import { headers } from 'next/headers'
import './globals.css'
import Providers from '@/components/providers/Providers'
import { Analytics } from '@vercel/analytics/react'
import { AnalyticsConsent } from '@/components/analytics/AnalyticsConsent'
import { EarlySubmitScript } from '@/components/auth/EarlySubmitScript'
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
  // same nonce, as does the early-submit script. See
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
        {/* Holds a sign-in submit made before the page scripts run. */}
        <EarlySubmitScript nonce={nonce} />
      </head>
      <body className="font-sans antialiased bg-background text-foreground">
        <Providers nonce={nonce}>{children}</Providers>
        <Analytics />
        {analyticsServerKey() && <AnalyticsConsent />}
      </body>
    </html>
  )
}
