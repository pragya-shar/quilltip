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
  run: () => void | Promise<void>
}

/**
 * Something sign-out would strand, said before it happens (Write: words
 * saved on this device and not yet in the account). `check` answers one
 * plain sentence ("2 drafts are only on this device."), or null when there
 * is nothing to say. A check that throws, or takes longer than a short
 * limit, never stops a sign-out. Import the package's code lazily:
 *
 *   { name: 'device drafts',
 *     check: () => import('@/hooks/write/deviceDrafts').then((m) => m.signOutWarning()) }
 */
export type SignOutWarning = {
  name: string
  check: () => Promise<string | null>
}
