/** Below fixed nav (h-16) + thin progress strip; aligns with prose scroll-margin. */
export const ACTIVE_HEADING_TOP_OFFSET_PX = 96

/**
 * Returns the id of the heading that is currently "active" for TOC highlighting:
 * the last heading whose top edge is at or above the scroll offset threshold,
 * or the first heading found if none have crossed the threshold yet.
 */
export function pickActiveId(
  ids: string[],
  offsetPx = ACTIVE_HEADING_TOP_OFFSET_PX
): string | null {
  let active: string | null = null
  let firstFound: string | null = null

  for (const id of ids) {
    const el = document.getElementById(id)
    if (!el) continue
    if (firstFound == null) firstFound = id
    if (el.getBoundingClientRect().top <= offsetPx) {
      active = id
    }
  }

  return active ?? firstFound
}
