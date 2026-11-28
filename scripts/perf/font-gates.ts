/**
 * The font fallback check's gates, as pure functions over measured text
 * runs, so the rules have tests of their own (font-gates.test.ts).
 */

/** An element's own text: the summed width of its line pieces. */
export type Run = {
  key: string
  width: number
  family: string
  /** First family, weight and style: `readingFace 400 normal`. */
  font: string
}

/** Families of the reading faces' fallbacks. */
export const READING_FALLBACK = /Quilltip (Read|Display)[A-Za-z ]* Fallback/

/** The next page view's reading text, per font, within this of the cached
 * view's width. */
export const UPGRADE_TOLERANCE = 0.002

/** A reading font's text width changing more than this inside one view is
 * a change of face. */
export const FACE_CHANGE_TOLERANCE = 0.001

/** Per reading font, the width of `runs` against the same runs in
 * `reference` (matched by key). */
export function readingRatios(
  runs: readonly Run[],
  reference: readonly Run[]
): { font: string; ratio: number }[] {
  const byKey = new Map(reference.map((run) => [run.key, run]))
  const sums = new Map<string, { width: number; reference: number }>()
  for (const run of runs) {
    const other = byKey.get(run.key)
    if (!other || !READING_FALLBACK.test(run.family)) continue
    const sum = sums.get(run.font) ?? { width: 0, reference: 0 }
    sum.width += run.width
    sum.reference += other.width
    sums.set(run.font, sum)
  }
  return [...sums]
    .filter(([, sum]) => sum.reference > 0)
    .map(([font, sum]) => ({ font, ratio: sum.width / sum.reference }))
}

/** The next page view must read in the web fonts: every reading font at
 * its cached width. One font that did not upgrade fails on its own. */
export function upgradeFailures(
  label: string,
  next: readonly Run[] | undefined,
  cached: readonly Run[]
): string[] {
  if (!next) return [`${label}: not measured`]
  const ratios = readingRatios(next, cached)
  if (ratios.length === 0) return [`${label}: no reading text measured`]
  // Every reading font of the cached view is in the next one (by its runs'
  // keys): a font missing there would pass unseen.
  const nextReading = new Set(
    next
      .filter((run) => READING_FALLBACK.test(run.family))
      .map((run) => run.key)
  )
  const cachedFonts = new Map<string, string[]>()
  for (const run of cached)
    if (READING_FALLBACK.test(run.family))
      cachedFonts.set(run.font, [...(cachedFonts.get(run.font) ?? []), run.key])
  const missing = [...cachedFonts]
    .filter(([, keys]) => !keys.some((key) => nextReading.has(key)))
    .map(([font]) => `${label}: text in ${font} is missing from the next view`)
  return [
    ...missing,
    ...ratios
      .filter(({ ratio }) => Math.abs(ratio - 1) > UPGRADE_TOLERANCE)
      .map(
        ({ font, ratio }) =>
          `${label}: text in ${font} is ${ratio.toFixed(3)} times its width in the web fonts (not upgraded)`
      ),
  ]
}

/** Reading fonts whose text width changed inside one view. */
export function changedFaces(
  before: readonly Run[],
  after: readonly Run[]
): { font: string; ratio: number }[] {
  return readingRatios(after, before).filter(
    ({ ratio }) => Math.abs(ratio - 1) > FACE_CHANGE_TOLERANCE
  )
}

/** A late view that held no font request measured nothing. `required`:
 * the case needs one (the page draws the text the held files are for). */
export function heldFailures(
  label: string,
  held: number,
  required: boolean
): string[] {
  return required && held === 0
    ? [
        `${label}: no font request was held back, so the late view measured nothing`,
      ]
    : []
}
