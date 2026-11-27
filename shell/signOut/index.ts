/**
 * Everything cleared from this browser on sign-out, one file per package;
 * the shell runs them and never imports a surface. A package adds its
 * file's entries.
 */
import type { SignOutCleanup } from './types'
import { cleanups as ops } from './ops'
import { cleanups as pocket } from './pocket'
import { cleanups as read } from './read'
import { cleanups as resources } from './resources'
import { cleanups as search } from './search'
import { cleanups as shelf } from './shelf'
import { cleanups as signin } from './signin'
import { cleanups as today } from './today'
import { cleanups as write } from './write'
import { cleanups as writer } from './writer'
import { cleanups as you } from './you'

export type { SignOutCleanup } from './types'

export const SIGN_OUT_PACKAGES = {
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
} satisfies Record<string, readonly SignOutCleanup[]>

export const SIGN_OUT_CLEANUPS: readonly SignOutCleanup[] =
  Object.values(SIGN_OUT_PACKAGES).flat()

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
