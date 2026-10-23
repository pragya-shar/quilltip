import type { Metadata } from 'next'
import './globals.css'
import './highlights.css'
import Providers from '@/components/providers/Providers'
import { Analytics } from '@vercel/analytics/react'
import { SITE_META_DESCRIPTION } from '@/lib/copy/landing-sections'

export const metadata: Metadata = {
  title: 'Quilltip - Decentralized Publishing Platform',
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
      </body>
    </html>
  )
}
