import type { Metadata, Viewport } from 'next'
import { headers } from 'next/headers'
import '@/system/system.css'
import '@/shell/shell.css'
import {
  readingFace,
  readingFaceStyle,
  readingItalicFace,
} from '@/system/fonts'
import { ToastRegion } from '@/system/components/ToastRegion'
import { AppProviders } from '@/shell/AppProviders'
import { AppShell } from '@/shell/AppShell'
import { PaymentsSlot } from '@/shell/PaymentsSlot'
import { SheetHost } from '@/shell/SheetHost'
import { PRE_PAINT_SCRIPT } from '@/shell/prePaint'
import { NONCE_HEADER } from '@/lib/security/contentSecurityPolicy'
import { SITE_NAME, SITE_ORIGIN } from '@/lib/seo/siteMetadata'

export const metadata: Metadata = {
  metadataBase: new URL(SITE_ORIGIN),
  title: { default: SITE_NAME, template: `%s · ${SITE_NAME}` },
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  // Content may run under the notch and home indicator; the shell pads it
  // with the safe-area tokens.
  viewportFit: 'cover',
  // Android Chrome shrinks the layout for the on-screen keyboard, so fixed
  // controls stay above it.
  interactiveWidget: 'resizes-content',
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#f8fafc' },
    { media: '(prefers-color-scheme: dark)', color: '#0a0e11' },
  ],
}

/**
 * The application's root layout, beside app/(legacy)'s. It loads only the
 * design system's CSS and the reading face, and composes its own providers.
 * No loading.tsx or Suspense sits above page content in this group's root
 * or public segment: reading arrives in the first response and works with
 * no script. Loading boundaries belong in app/(app)/(signed-in)/.
 */
export default async function AppRootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  // Reading the request renders every page per request, so Next.js adds the
  // CSP nonce from proxy.ts to its own scripts; the theme script gets it too.
  const nonce = (await headers()).get(NONCE_HEADER) ?? undefined
  return (
    <html
      lang="en"
      className={`${readingFace.variable} ${readingItalicFace.variable}`}
      style={readingFaceStyle}
      suppressHydrationWarning
    >
      <head>
        {/* Before paint: the stored theme, and whether a session token
            is held (shell/prePaint.ts). */}
        <script
          nonce={nonce}
          dangerouslySetInnerHTML={{ __html: PRE_PAINT_SCRIPT }}
        />
      </head>
      <body>
        <AppProviders>
          <AppShell
            beside={
              <>
                <SheetHost />
                <ToastRegion />
                <PaymentsSlot />
              </>
            }
          >
            {children}
          </AppShell>
        </AppProviders>
      </body>
    </html>
  )
}
