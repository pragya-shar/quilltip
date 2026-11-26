/**
 * WalletConnect (mobile wallets) is not supported yet. The Wallets Kit
 * WalletConnect module depends on Reown AppKit, which this app runs on zod 4
 * through a package override (zod 3 has an unpatched advisory). That
 * combination has not been tested, so a configured project ID stops the app:
 * `next.config.ts` refuses to build, run the dev server or start, and the
 * wallet refuses to load in the browser.
 */

export const WALLETCONNECT_UNSUPPORTED_MESSAGE =
  'WalletConnect is not supported yet: its Reown AppKit dependency has not been tested with the zod 4 override. Unset NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID.'

/** Throws when a WalletConnect project ID is set (blank counts as unset). */
export function assertWalletConnectNotConfigured(
  projectId: string | undefined
): void {
  if (!projectId?.trim()) return
  console.error(`[wallet] ${WALLETCONNECT_UNSUPPORTED_MESSAGE}`)
  throw new Error(WALLETCONNECT_UNSUPPORTED_MESSAGE)
}
