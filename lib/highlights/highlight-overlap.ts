export type HighlightRangeInput = {
  id: string
  startOffset: number
  endOffset: number
  createdAt: number
}

export function rangesOverlap(
  aStart: number,
  aEnd: number,
  bStart: number,
  bEnd: number
): boolean {
  return aStart < bEnd && bStart < aEnd
}

export function countRangesOverlapping(
  ranges: HighlightRangeInput[],
  start: number,
  end: number
): number {
  let count = 0
  for (const range of ranges) {
    if (rangesOverlap(range.startOffset, range.endOffset, start, end)) {
      count++
    }
  }
  return Math.min(count, 5)
}

/** Innermost (shortest) span wins; tie-break to newest highlight. */
export function pickPrimaryRange<T extends HighlightRangeInput>(
  covering: T[]
): T {
  return [...covering].sort((a, b) => {
    const spanA = a.endOffset - a.startOffset
    const spanB = b.endOffset - b.startOffset
    if (spanA !== spanB) return spanA - spanB
    return b.createdAt - a.createdAt
  })[0]!
}

export interface HighlightSegment<T extends HighlightRangeInput> {
  startOffset: number
  endOffset: number
  overlapCount: number
  primary: T
}

export function buildHighlightSegments<T extends HighlightRangeInput>(
  highlights: T[]
): HighlightSegment<T>[] {
  if (highlights.length === 0) return []

  const breakpoints = new Set<number>()
  for (const highlight of highlights) {
    breakpoints.add(highlight.startOffset)
    breakpoints.add(highlight.endOffset)
  }

  const sorted = [...breakpoints].sort((a, b) => a - b)
  const segments: HighlightSegment<T>[] = []

  for (let i = 0; i < sorted.length - 1; i++) {
    const startOffset = sorted[i]!
    const endOffset = sorted[i + 1]!
    if (startOffset >= endOffset) continue

    const covering = highlights.filter((h) =>
      rangesOverlap(h.startOffset, h.endOffset, startOffset, endOffset)
    )
    if (covering.length === 0) continue

    segments.push({
      startOffset,
      endOffset,
      overlapCount: Math.min(covering.length, 5),
      primary: pickPrimaryRange(covering),
    })
  }

  return segments
}
