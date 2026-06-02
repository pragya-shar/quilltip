export const WALLET_PROFILE_HUB_PATH = '/profile?tab=wallet'

export function getWalletTabPath(username: string): string {
  return `/${username}?tab=wallet`
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
