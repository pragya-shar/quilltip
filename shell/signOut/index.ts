/**
 * Everything cleared from this browser on sign-out, one file per package;
 * the shell runs them and never imports a surface. A package adds its
 * file's entries.
 */
import type { SignOutCleanup, SignOutWarning, SignOutWho } from './types'
import * as ops from './ops'
import * as pocket from './pocket'
import * as read from './read'
import * as resources from './resources'
import * as search from './search'
import * as shelf from './shelf'
import * as signin from './signin'
import * as today from './today'
import * as write from './write'
import * as writer from './writer'
import * as you from './you'

export type { SignOutCleanup, SignOutWarning, SignOutWho } from './types'

const PACKAGES = {
  ops,
  pocket,
  read,
  resources,
  search,
  shelf,
  signin,
  today,
  write,
  writer,
  you,
} satisfies Record<
  string,
  {
    cleanups: readonly SignOutCleanup[]
    warnings: readonly SignOutWarning[]
  }
>

export const SIGN_OUT_PACKAGES = Object.fromEntries(
  Object.entries(PACKAGES).map(([name, pkg]) => [name, pkg.cleanups])
) as Record<keyof typeof PACKAGES, readonly SignOutCleanup[]>

export const SIGN_OUT_CLEANUPS: readonly SignOutCleanup[] = Object.values(
  PACKAGES
).flatMap((pkg) => pkg.cleanups)

export const SIGN_OUT_WARNINGS: readonly SignOutWarning[] = Object.values(
  PACKAGES
).flatMap((pkg) => pkg.warnings)

/** How long a warning check may take before sign-out goes on without it. */
export const WARNING_LIMIT_MS = 800

/**
 * The sentences to show before signing out: every check at once, each
 * bounded by `limitMs`; one that throws or answers late says nothing.
 */
export async function signOutWarnings(
  warnings: readonly SignOutWarning[] = SIGN_OUT_WARNINGS,
  limitMs = WARNING_LIMIT_MS,
  who: SignOutWho = { userId: null }
): Promise<string[]> {
  const answers = await Promise.all(
    warnings.map(async (warning) => {
      let timer: ReturnType<typeof setTimeout> | undefined
      try {
        return await Promise.race([
          warning.check(who),
          new Promise<null>((resolve) => {
            timer = setTimeout(() => resolve(null), limitMs)
          }),
        ])
      } catch {
        return null
      } finally {
        clearTimeout(timer)
      }
    })
  )
  return answers.filter(
    (answer): answer is string =>
      typeof answer === 'string' && answer.trim() !== ''
  )
}

/**
 * Runs every cleanup; one that fails is logged and does not stop the rest.
 * Returns the names of those that failed.
 */
export async function runSignOutCleanups(
  cleanups: readonly SignOutCleanup[] = SIGN_OUT_CLEANUPS
): Promise<string[]> {
  const failed: string[] = []
  await Promise.all(
    cleanups.map(async (cleanup) => {
      try {
        await cleanup.run()
      } catch (error) {
        console.error(`Sign-out cleanup "${cleanup.name}" failed`, error)
        failed.push(cleanup.name)
      }
    })
  )
  return failed
}
