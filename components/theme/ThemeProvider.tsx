'use client'

import { ThemeProvider as NextThemesProvider } from 'next-themes'

export function ThemeProvider({
  children,
  nonce,
}: {
  children: React.ReactNode
  /** CSP nonce for the inline script that applies the theme before paint. */
  nonce?: string
}) {
  return (
    <NextThemesProvider
      nonce={nonce}
      attribute="class"
      defaultTheme="system"
      enableSystem
      disableTransitionOnChange
    >
      {children}
    </NextThemesProvider>
  )
}
