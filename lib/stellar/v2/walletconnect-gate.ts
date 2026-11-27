/**
 * WalletConnect (mobile wallets) is on when `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID`
 * holds a Reown project ID, and off when it is unset or blank. A value that
 * is not a project ID (32 lowercase hexadecimal characters) stops the app:
 * `next.config.ts` refuses to build, run the dev server or start, and the
 * wallet refuses to load in the browser.
 *
 * The ID is public configuration, set per deployment and in `.env.local`;
 * it is never committed. Quilltip's WalletConnect module
 * (`walletconnect-module.ts`) talks to `@walletconnect/sign-client` directly
 * and never loads Reown AppKit, the only code that uses zod
 * (docs/wallets.md, "WalletConnect").
 */

export const WALLETCONNECT_PROJECT_ID_PATTERN = /^[0-9a-f]{32}$/

export const WALLETCONNECT_INVALID_MESSAGE =
  'NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID is not a Reown project ID (32 lowercase hexadecimal characters). Fix it, or unset it to turn WalletConnect off.'

/**
 * The project ID when WalletConnect is configured, null when it is off.
 * Throws for a value that is not a project ID.
 */
export function walletConnectProjectId(
  value: string | undefined
): string | null {
  const id = value?.trim()
  if (!id) return null
  if (!WALLETCONNECT_PROJECT_ID_PATTERN.test(id)) {
    console.error(`[wallet] ${WALLETCONNECT_INVALID_MESSAGE}`)
    throw new Error(WALLETCONNECT_INVALID_MESSAGE)
  }
  return id
}

/** The ID this build was configured with, or null. */
export function configuredWalletConnectProjectId(): string | null {
  return walletConnectProjectId(
    process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID
  )
}
