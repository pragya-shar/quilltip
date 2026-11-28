import type { SignOutCleanup, SignOutWarning } from './types'

/** What the shelf package clears on sign-out. Owned by that package. */
export const cleanups: readonly SignOutCleanup[] = []

/** What the shelf package warns of before sign-out. Owned by that package. */
export const warnings: readonly SignOutWarning[] = []
