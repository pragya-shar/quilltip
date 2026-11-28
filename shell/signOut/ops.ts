import type { SignOutCleanup, SignOutWarning } from './types'

/** What the ops package clears on sign-out. Owned by that package. */
export const cleanups: readonly SignOutCleanup[] = []

/** What the ops package warns of before sign-out. Owned by that package. */
export const warnings: readonly SignOutWarning[] = []
