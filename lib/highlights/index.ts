/**
 * QuillTip Highlights System
 *
 * This module provides the core highlighting functionality for QuillTip,
 * including text selection management, highlight serialization, and utilities.
 */

export { SelectionManager } from './SelectionManager'
export { HighlightSerializer } from './HighlightSerializer'
export type {
  TextSelection,
  SerializedHighlight,
  SelectionCallback,
  SelectionManagerOptions,
} from './types'
export * from './utils'
