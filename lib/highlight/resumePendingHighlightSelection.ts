import type { Editor } from '@tiptap/react'
import {
  getRangeTopCenterAnchor,
  getSafeSelection,
} from '@/lib/highlights/utils'
import type { PendingHighlightSelection } from '@/lib/highlight/pendingHighlightSelection'

export function applyPendingHighlightToEditor(
  editor: Editor,
  pending: PendingHighlightSelection
): void {
  editor
    .chain()
    .focus()
    .setTextSelection({ from: pending.startOffset, to: pending.endOffset })
    .scrollIntoView()
    .run()
}

/** Viewport anchor from the editor selection (works without a native DOM range). */
export function readEditorSelectionAnchor(
  editor: Editor
): { top: number; left: number } | null {
  const { from, to, empty } = editor.state.selection
  if (empty || to <= from) return null

  try {
    const start = editor.view.coordsAtPos(from)
    const end = editor.view.coordsAtPos(to)
    return {
      top: Math.min(start.top, end.top),
      left: (start.left + end.left) / 2,
    }
  } catch {
    return null
  }
}

export function readPendingHighlightPopoverAnchor(
  editor: Editor
): { top: number; left: number } | null {
  const fromEditor = readEditorSelectionAnchor(editor)
  if (fromEditor) return fromEditor

  const domSelection = getSafeSelection()
  if (!domSelection || domSelection.rangeCount === 0) return null
  const range = domSelection.getRangeAt(0)
  return getRangeTopCenterAnchor(range)
}

export function shouldKeepTryingHighlightSelectionResume(
  pending: PendingHighlightSelection | null,
  articleId: string,
  restoredEditor: Editor | null,
  currentEditor: Editor | null
): boolean {
  if (pending === null || pending.articleId !== articleId) return false
  if (currentEditor === null) return false
  return restoredEditor !== currentEditor
}
