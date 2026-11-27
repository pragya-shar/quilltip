import type { ReadingPosition } from '@/lib/articles/readingProgress'

/** The body's box against the viewport: `getBoundingClientRect()`. */
export type BodyBounds = { top: number; height: number }

/**
 * Where the reader is in the body: `ratio` is how much of it has passed the
 * bottom of the screen, `offset` how much has passed the top. Null before
 * the body has a height.
 */
export function positionIn(
  id: string,
  bounds: BodyBounds,
  viewportHeight: number
): ReadingPosition | null {
  if (!bounds.height) return null
  return {
    id,
    ratio: (viewportHeight - bounds.top) / bounds.height,
    offset: Math.max(0, Math.min(1, -bounds.top / bounds.height)),
  }
}

/**
 * How far to scroll to return to `position`. With the body still below the
 * top of the screen (`offset` 0), the saved visible share is used, so the
 * page never jumps further than the reader had read.
 */
export function scrollDeltaFor(
  position: ReadingPosition,
  bounds: BodyBounds,
  viewportHeight: number
): number {
  return position.offset
    ? bounds.top + bounds.height * position.offset
    : bounds.top + bounds.height * position.ratio - viewportHeight
}

/**
 * Whether to return the reader to their place on this open. Always, unless
 * the address names a place (`#section`) or the browser restores the scroll
 * itself (back and forward).
 */
export function shouldRestore(input: {
  hash: string
  navigationType: string | undefined
  /** The address names a line (`?highlight=`): that wins over the place. */
  aimed?: boolean
}): boolean {
  if (input.hash || input.aimed) return false
  return input.navigationType !== 'back_forward'
}

/** The block at the reading line (a third down the screen), for the tick. */
export const READING_LINE = 1 / 3
