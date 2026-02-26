/**
 * Text selection interface for capturing user selections
 */
export interface TextSelection {
  text: string
  range: Range
  startContainer: Node
  endContainer: Node
  startOffset: number
  endOffset: number
}

/**
 * Serialized highlight format for persistence
 */
export interface SerializedHighlight {
  articleId: string
  text: string
  startOffset: number
  endOffset: number
  startNode: string
  endNode: string
  color?: string
  isPublic?: boolean
  id?: string
  createdAt?: string
}

/**
 * Selection change callback type
 */
export type SelectionCallback = (selection: TextSelection) => void

/**
 * Selection manager configuration options
 */
export interface SelectionManagerOptions {
  debounceMs?: number
  minSelectionLength?: number
  maxSelectionLength?: number
}
