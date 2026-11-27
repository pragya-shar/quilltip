import { EARLY_SUBMIT_SCRIPT } from '@/lib/auth/earlySubmit'
import { EARLY_MENU_SCRIPT } from '@/lib/navigation/earlyMenu'

/**
 * Answers presses made before the page scripts run: it holds an auth form
 * submit (lib/auth/earlySubmit.ts) and keeps focus out of the page behind the
 * mobile menu popover (lib/navigation/earlyMenu.ts). The root layout renders
 * it first in `<body>`, so it runs before any form or menu is parsed, with
 * the request's CSP nonce.
 */
export function EarlyInteractionScript({ nonce }: { nonce?: string }) {
  return (
    <script
      nonce={nonce}
      dangerouslySetInnerHTML={{
        __html: `${EARLY_SUBMIT_SCRIPT};${EARLY_MENU_SCRIPT}`,
      }}
    />
  )
}
