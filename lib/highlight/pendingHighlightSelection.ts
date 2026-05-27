import { z } from 'zod'
import type { Id } from '@/convex/_generated/dataModel'

export const PENDING_HIGHLIGHT_SELECTION_STORAGE_KEY =
  'quilltip:pendingHighlightSelection'

const pendingHighlightSelectionSchema = z.object({
  articleId: z.string(),
  highlightText: z.string(),
  startOffset: z.number().int().nonnegative(),
  endOffset: z.number().int().nonnegative(),
})

export type PendingHighlightSelection = z.infer<
  typeof pendingHighlightSelectionSchema
>

export function writePendingHighlightSelection(
  selection: PendingHighlightSelection
): void {
  if (typeof window === 'undefined') return
  try {
    window.sessionStorage.setItem(
      PENDING_HIGHLIGHT_SELECTION_STORAGE_KEY,
      JSON.stringify(selection)
    )
  } catch {
    // Quota or private mode
  }
}

export function readPendingHighlightSelection(): PendingHighlightSelection | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = window.sessionStorage.getItem(
      PENDING_HIGHLIGHT_SELECTION_STORAGE_KEY
    )
    if (raw === null) return null
    const parsed: unknown = JSON.parse(raw)
    const result = pendingHighlightSelectionSchema.safeParse(parsed)
    return result.success ? result.data : null
  } catch {
    return null
  }
}

export function clearPendingHighlightSelection(): void {
  if (typeof window === 'undefined') return
  try {
    window.sessionStorage.removeItem(PENDING_HIGHLIGHT_SELECTION_STORAGE_KEY)
  } catch {
    // Ignore
  }
}

export function matchesPendingHighlightSelection(
  selection: PendingHighlightSelection | null,
  articleId: Id<'articles'> | string
): selection is PendingHighlightSelection {
  return selection !== null && selection.articleId === String(articleId)
}
