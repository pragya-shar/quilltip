import type { SignOutCleanup, SignOutWarning } from './types'

/** What the write package clears on sign-out. Owned by that package. */
export const cleanups: readonly SignOutCleanup[] = []

/** What the write package warns of before sign-out. Owned by that package. */
export const warnings: readonly SignOutWarning[] = []
