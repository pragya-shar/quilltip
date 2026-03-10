import type { Metadata } from 'next'
import { Inter, Caveat, Fraunces } from 'next/font/google'
import './globals.css'
import './highlights.css'
import Providers from '@/components/providers/Providers'
import { Analytics } from '@vercel/analytics/react'

const inter = Inter({
  subsets: ['latin'],
  variable: '--font-sans',
})

const caveat = Caveat({
  subsets: ['latin'],
  variable: '--font-handwritten',
})

const fraunces = Fraunces({
  subsets: ['latin'],
  variable: '--font-display',
})

export const metadata: Metadata = {
  title: 'Quilltip - Decentralized Publishing Platform',
  description:
    'Write, share, and monetize your content with Stellar-powered microtipping',
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="en">
      <body
        className={`${inter.variable} ${caveat.variable} ${fraunces.variable} font-sans antialiased bg-brand-cream`}
      >
        <Providers>{children}</Providers>
        <Analytics />
      </body>
    </html>
  )
}
