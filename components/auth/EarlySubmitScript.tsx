import { EARLY_SUBMIT_SCRIPT } from '@/lib/auth/earlySubmit'

/**
 * Holds an auth form submit made before the page scripts run
 * (lib/auth/earlySubmit.ts). The root layout renders it in `<head>`, so it
 * runs before any form is parsed, with the request's CSP nonce. It does
 * nothing on a page without such a form.
 */
export function EarlySubmitScript({ nonce }: { nonce?: string }) {
  return (
    <script
      nonce={nonce}
      dangerouslySetInnerHTML={{ __html: EARLY_SUBMIT_SCRIPT }}
    />
  )
}
