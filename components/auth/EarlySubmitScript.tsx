import { EARLY_SUBMIT_SCRIPT } from '@/lib/auth/earlySubmit'

/**
 * Holds an auth form submit made before the page scripts run
 * (lib/auth/earlySubmit.ts). The auth layout renders it before the form, with
 * the request's CSP nonce, so it runs first; other pages do not carry it.
 */
export function EarlySubmitScript({ nonce }: { nonce?: string }) {
  return (
    <script
      nonce={nonce}
      dangerouslySetInnerHTML={{ __html: EARLY_SUBMIT_SCRIPT }}
    />
  )
}
