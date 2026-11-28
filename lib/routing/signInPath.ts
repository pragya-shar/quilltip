import { readdirSync } from 'node:fs'
import path from 'node:path'

/** The legacy sign-in page, until the shell's own ships. */
export const LEGACY_SIGN_IN_PATH = '/login'
/** The shell's sign-in page. */
export const SHELL_SIGN_IN_PATH = '/signin'

/**
 * Where "Sign in" goes, read from the route tree at build (next.config.ts):
 * the shell's page once a `signin/page.tsx` exists under app/(app), the
 * legacy page until then (which redirects to the new one after). So the link
 * is right before and after the sign-in package lands, with no edit.
 * Node only; the shell reads the result from NEXT_PUBLIC_SIGN_IN_PATH.
 */
export function signInPathFromRoutes(
  appDir = path.join(process.cwd(), 'app/(app)')
): string {
  let files: string[]
  try {
    files = readdirSync(appDir, { recursive: true }) as string[]
  } catch {
    return LEGACY_SIGN_IN_PATH
  }
  const shipped = files.some((file) =>
    /(^|[\\/])signin[\\/]page\.(tsx|ts|jsx|js)$/.test(file)
  )
  return shipped ? SHELL_SIGN_IN_PATH : LEGACY_SIGN_IN_PATH
}
