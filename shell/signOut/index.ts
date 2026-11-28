/**
 * Everything cleared from this browser on sign-out, one file per package;
 * the shell runs them and never imports a surface. A package adds its
 * file's entries.
 */
import type {
  SignOutAction,
  SignOutAfter,
  SignOutCleanup,
  SignOutWarning,
  SignOutWho,
} from './types'
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

export type {
  SignOutAction,
  SignOutAfter,
  SignOutCleanup,
  SignOutWarning,
  SignOutWho,
} from './types'

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
    /** Optional: what the package does with the server before the session
     * ends (`SignOutAction`). */
    beforeSignOut?: readonly SignOutAction[]
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

export const SIGN_OUT_BEFORE: readonly SignOutAction[] = Object.values(
  PACKAGES
).flatMap(
  (pkg) =>
    (pkg as { beforeSignOut?: readonly SignOutAction[] }).beforeSignOut ?? []
)

/** How long an action before sign-out may take before sign-out goes on. */
export const BEFORE_LIMIT_MS = 800

/**
 * Runs every action before sign-out at once, each bounded by `limitMs`; one
 * that throws or runs late is dropped. Resolves within `limitMs` (plus a
 * moment) whatever the actions do. Returns the names of those that did not
 * finish.
 */
export async function runBeforeSignOut(
  actions: readonly SignOutAction[] = SIGN_OUT_BEFORE,
  who: SignOutWho = { userId: null },
  limitMs = BEFORE_LIMIT_MS
): Promise<string[]> {
  const results = await Promise.all(
    actions.map(async (action) => {
      let timer: ReturnType<typeof setTimeout> | undefined
      try {
        const done = await Promise.race([
          action.run(who).then(() => true),
          new Promise<false>((resolve) => {
            timer = setTimeout(() => resolve(false), limitMs)
          }),
        ])
        return done ? null : action.name
      } catch {
        return action.name
      } finally {
        clearTimeout(timer)
      }
    })
  )
  return results.filter((name): name is string => name !== null)
}

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
 * Runs every cleanup, telling each what did not finish before sign-out;
 * one that fails is logged and does not stop the rest. Returns the names of
 * those that failed.
 */
export async function runSignOutCleanups(
  cleanups: readonly SignOutCleanup[] = SIGN_OUT_CLEANUPS,
  after: SignOutAfter = { unfinished: [] }
): Promise<string[]> {
  const failed: string[] = []
  await Promise.all(
    cleanups.map(async (cleanup) => {
      try {
        await cleanup.run(after)
      } catch (error) {
        console.error(`Sign-out cleanup "${cleanup.name}" failed`, error)
        failed.push(cleanup.name)
      }
    })
  )
  return failed
}
