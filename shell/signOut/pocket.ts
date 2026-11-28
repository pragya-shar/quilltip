import type { SignOutCleanup, SignOutWarning } from './types'

/** What the pocket package clears on sign-out. Owned by that package. */
export const cleanups: readonly SignOutCleanup[] = []

/** What the pocket package warns of before sign-out. Owned by that package. */
export const warnings: readonly SignOutWarning[] = []
