import type { SignOutCleanup } from './types'

/** What the search package clears on sign-out. Owned by that package. */
export const cleanups: readonly SignOutCleanup[] = []
