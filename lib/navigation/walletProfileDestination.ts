export const WALLET_PROFILE_HUB_PATH = '/dashboard/wallet'

export function getDashboardWalletPath(): string {
  return '/dashboard/wallet'
}

export function getLoginRedirectPath(intendedPath: string): string {
  return `/login?redirect=${encodeURIComponent(intendedPath)}`
}

export function getSafeRedirectPath(
  raw: string | null | undefined,
  fallback = '/'
): string {
  if (!raw) return fallback
  if (!raw.startsWith('/') || raw.startsWith('//') || raw.includes(':')) {
    return fallback
  }
  return raw
}
