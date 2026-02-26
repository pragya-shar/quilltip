import { Editor } from '@tiptap/react'
import { TextSelection } from '@tiptap/pm/state'
import { Node } from '@tiptap/pm/model'
import { Id } from '@/convex/_generated/dataModel'

export interface HighlightData {
  _id: Id<'highlights'>
  text: string
  startOffset: number
  endOffset: number
  startContainerPath: string
  endContainerPath: string
  color?: string
  note?: string
  isPublic: boolean
  userId: Id<'users'>
  userName?: string
  userAvatar?: string
  createdAt: number
}

export class HighlightConverter {
  /**
   * Convert a TipTap document position to a text-only offset
   * This accounts for the fact that TipTap positions include structural nodes
   */
  private static getTextOffset(doc: Node, position: number): number {
    let textOffset = 0
    let found = false

    doc.descendants((node: Node, pos: number) => {
      if (found) return false

      // Check if position is within this node
      const nodeEnd = pos + node.nodeSize

      if (node.isText) {
        if (position >= pos && position <= nodeEnd) {
          // Our position is within this text node
          textOffset += position - pos
          found = true
          return false
        } else if (position > nodeEnd) {
          // Add the entire text node to our offset
          textOffset += node.text?.length || 0
        }
      }
    })

    return textOffset
  }

  /**
   * Convert a text offset to a TipTap document position
   */
  private static getDocumentPosition(doc: Node, textOffset: number): number {
    let currentTextOffset = 0
    let documentPosition = 0
    let found = false

    doc.descendants((node: Node, pos: number) => {
      if (found) return false

      if (node.isText) {
        const textLength = node.text?.length || 0
        if (currentTextOffset + textLength >= textOffset) {
          // Found the position within this text node
          documentPosition = pos + (textOffset - currentTextOffset)
          found = true
          return false
        }
        currentTextOffset += textLength
      }
    })

    return documentPosition || textOffset // Fallback to textOffset if not found
  }

  /**
   * Apply highlights to the TipTap editor as marks
   */
  static applyHighlightsToEditor(editor: Editor, highlights: HighlightData[]) {
    if (!editor) return

    try {
      // ALWAYS clear existing highlight marks first (even if highlights array is empty)
      // This ensures deleted highlights are properly removed from the editor
      editor.chain().unsetHighlight().run()

      // Early return if no highlights to apply
      if (!highlights.length) return

      // Sort highlights by position to apply them in order
      const sortedHighlights = [...highlights].sort(
        (a, b) => a.startOffset - b.startOffset
      )

      // Apply each highlight as a mark (without focusing for performance)
      sortedHighlights.forEach((highlight) => {
        try {
          // Convert text offsets to document positions
          const from = this.getDocumentPosition(
            editor.state.doc,
            highlight.startOffset
          )
          const to = this.getDocumentPosition(
            editor.state.doc,
            highlight.endOffset
          )

          // Verify the positions are valid
          if (from >= 0 && to > from && to <= editor.state.doc.content.size) {
            // Verify the text matches what we expect
            const actualText = editor.state.doc.textBetween(from, to, ' ')

            // Allow some flexibility for whitespace differences
            const normalizedActual = actualText.trim()
            const normalizedExpected = highlight.text.trim()

            if (
              normalizedActual === normalizedExpected ||
              normalizedActual.includes(normalizedExpected) ||
              normalizedExpected.includes(normalizedActual)
            ) {
              // Apply the highlight mark with all attributes (no focus for performance)
              editor
                .chain()
                .setTextSelection({ from, to })
                .setHighlight({
                  id: highlight._id,
                  color: highlight.color || '#FFEB3B',
                  userId: highlight.userId,
                  userName: highlight.userName,
                  note: highlight.note,
                  createdAt: highlight.createdAt,
                })
                .run()
            } else {
              console.warn('Text mismatch for highlight:', {
                expected: highlight.text,
                actual: actualText,
                from,
                to,
              })
            }
          } else {
            console.warn('Invalid positions for highlight:', {
              from,
              to,
              docSize: editor.state.doc.content.size,
            })
          }
        } catch (error) {
          console.error('Failed to apply highlight:', error, highlight)
        }
      })
    } catch (error) {
      console.error('Error applying highlights to editor:', error)
    }
  }

  /**
   * Convert a text selection to highlight data for storage
   */
  static selectionToHighlightData(
    editor: Editor,
    selection: TextSelection,
    additionalData: {
      color?: string
      note?: string
      isPublic?: boolean
    }
  ): Omit<
    HighlightData,
    '_id' | 'userId' | 'userName' | 'userAvatar' | 'createdAt'
  > {
    const { from, to } = selection
    const selectedText = editor.state.doc.textBetween(from, to, ' ')

    // Convert document positions to text offsets
    const startOffset = this.getTextOffset(editor.state.doc, from)
    const endOffset = this.getTextOffset(editor.state.doc, to)

    return {
      text: selectedText,
      startOffset,
      endOffset,
      startContainerPath: `text.${from}`,
      endContainerPath: `text.${to}`,
      color: additionalData.color || '#FFEB3B',
      note: additionalData.note,
      isPublic: additionalData.isPublic !== false,
    }
  }

  /**
   * Create a highlight from the current editor selection
   */
  static createHighlightFromSelection(
    editor: Editor,
    additionalData: {
      color?: string
      note?: string
      isPublic?: boolean
    }
  ) {
    const { selection } = editor.state

    if (selection.empty) {
      return null
    }

    const { from, to } = selection
    const selectedText = editor.state.doc.textBetween(from, to, ' ')

    if (selectedText.trim().length < 3) {
      return null
    }

    // Convert document positions to text offsets
    const startOffset = this.getTextOffset(editor.state.doc, from)
    const endOffset = this.getTextOffset(editor.state.doc, to)

    return {
      text: selectedText,
      startOffset,
      endOffset,
      startContainerPath: `text.${from}`,
      endContainerPath: `text.${to}`,
      ...additionalData,
    }
  }
}
