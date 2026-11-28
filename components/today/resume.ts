import type { ReadingPlace } from './readingPlace'

/**
 * The article "Your place" opens: the newest one started, not finished, with
 * a title to show. Any stored entry counts as opened; the row offers
 * the newest unfinished one.
 */
export function currentPlace(places: ReadingPlace[]): ReadingPlace | null {
  return (
    places.find(
      (place) => !place.finished && place.percent > 0 && place.title.trim()
    ) ?? null
  )
}
