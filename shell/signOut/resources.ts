import type { SignOutCleanup, SignOutWarning } from './types'

/** What the resources package clears on sign-out. Owned by that package. */
export const cleanups: readonly SignOutCleanup[] = []

/** What the resources package warns of before sign-out. Owned by that package. */
export const warnings: readonly SignOutWarning[] = []
