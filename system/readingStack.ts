/**
 * A family list: Literata's Latin face, its Latin Extended face, then the
 * metric-matched fallback (system/font-fallbacks.css), which covers every
 * letter and so comes after both. No imports: the client builds lists with
 * it too (system/readingFaceUpgrade.ts).
 */
export function readingStack(
  latin: string,
  extended: string,
  fallback: string
): string {
  return [latin, extended, `'${fallback}'`].join(', ')
}
