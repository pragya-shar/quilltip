/**
 * Something a package clears from this browser when the person signs out,
 * so the next person on the same browser does not inherit it (for example
 * the reading places: a reader's place belongs to the browser). Import the
 * package's own code lazily, so nothing loads until sign-out:
 *
 *   { name: 'reading places',
 *     run: () => import('@/hooks/read/readingPlace').then((m) => m.clearReadingPlaces()) }
 */
export type SignOutCleanup = {
  name: string
  run: (after: SignOutAfter) => void | Promise<void>
}

/** What the cleanups learn about the sign-out that just ran. */
export type SignOutAfter = {
  /**
   * The names of the actions before sign-out that did not finish on this
   * page (they threw or ran past the limit): a package marks that work
   * "not confirmed" and tries again at the next sign-in. Empty when every
   * action finished, when none ran (no session token held), and when the
   * cleanups run on a later page (a page change mid sign-out, another tab,
   * a legacy page), which cannot know.
   */
  unfinished: readonly string[]
}

/**
 * Something a package does with the server while the person is still
 * signed in, just before the session ends (Pocket: revoke this browser's
 * quick-tip keys, so the server stops taking them at once). Best effort:
 * every action runs at once, each within a short limit; one that throws or
 * runs late is dropped, and the sign-out never waits past the limit. Not
 * run when no session token is held (the session already ended): pair it
 * with a cleanup for what this browser must forget either way. Import the
 * package's code lazily:
 *
 *   { name: 'quick-tip keys',
 *     run: ({ userId }) => import('@/hooks/pocket/quickTips').then((m) => m.revokeKeys(userId)) }
 */
export type SignOutAction = {
  name: string
  run: (who: SignOutWho) => Promise<void>
}

/** Who is signing out, given to every warning check and every action
 * before sign-out. */
export type SignOutWho = {
  /** The signed-in user's id, asked when the sign-out starts; null when it
   * is not known (no answer in time, or no one signed in). A check or an
   * action that gets null does nothing rather than guess whose things to
   * act on: a check answers null, an action returns at once. */
  userId: string | null
}

/**
 * Something sign-out would strand, said before it happens (Write: words
 * saved on this device and not yet in the account). `check` gets who is
 * signing out, from the shell, so it knows whose things to look for even
 * when the package's own code has not run on this page; it answers one
 * plain sentence ("2 drafts are only on this device."), or null when there
 * is nothing to say. A check that throws, or takes longer than a short
 * limit, never stops a sign-out. Import the package's code lazily:
 *
 *   { name: 'device drafts',
 *     check: ({ userId }) =>
 *       import('@/hooks/write/deviceDrafts').then((m) => m.signOutWarning(userId)) }
 */
export type SignOutWarning = {
  name: string
  check: (who: SignOutWho) => Promise<string | null>
}
