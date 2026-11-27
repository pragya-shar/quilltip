/**
 * Something a package clears from this browser when the person signs out,
 * so the next person on the same browser does not inherit it (for example
 * the reading places, D-"Your place belongs to the browser"). Import the
 * package's own code lazily, so nothing loads until sign-out:
 *
 *   { name: 'reading places',
 *     run: () => import('@/hooks/read/readingPlace').then((m) => m.clearReadingPlaces()) }
 */
export type SignOutCleanup = {
  name: string
  run: () => void | Promise<void>
}
