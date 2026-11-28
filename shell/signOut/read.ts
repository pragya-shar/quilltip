import type { SignOutCleanup, SignOutWarning } from './types'

/** What the read package clears on sign-out. Owned by that package. */
export const cleanups: readonly SignOutCleanup[] = [
  {
    // Reading places belong to this browser, not the account: the next
    // person on it must not inherit them (the store and both cookies).
    name: 'reading places',
    run: () =>
      import('@/hooks/read/readingPlace').then((m) => m.clearReadingPlaces()),
  },
]

/** What the read package warns of before sign-out. Owned by that package. */
export const warnings: readonly SignOutWarning[] = []
