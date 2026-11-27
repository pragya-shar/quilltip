'use client'

import { EARLY_MENU_SCRIPT } from '@/lib/navigation/earlyMenu'

/**
 * Keeps focus out of the page behind the mobile menu popover before the page
 * scripts run (lib/navigation/earlyMenu.ts). The root layout renders it first
 * in `<body>`, with the request's CSP nonce, so it runs before the header is
 * parsed. A client component, so the script text is in the server HTML only
 * and not repeated in the page's React payload; the root layout is never
 * rendered again in the browser, so React only attaches to it.
 */
export function EarlyMenuScript({ nonce }: { nonce?: string }) {
  return (
    <script
      nonce={nonce}
      dangerouslySetInnerHTML={{ __html: EARLY_MENU_SCRIPT }}
    />
  )
}
