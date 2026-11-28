import type { SignOutCleanup, SignOutWarning } from './types'

/** What the signin package clears on sign-out. Owned by that package. */
export const cleanups: readonly SignOutCleanup[] = [
  {
    // What the last person was about to do never carries over to the next
    // person on this browser.
    name: 'sign-in intent',
    run: () => import('@/lib/auth/intent').then((m) => m.clearIntent()),
  },
]

/** What the signin package warns of before sign-out. Owned by that package. */
export const warnings: readonly SignOutWarning[] = []
