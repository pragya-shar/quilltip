import {
  TextSelection,
  SelectionCallback,
  SelectionManagerOptions,
} from './types'
import {
  isSelectionAPISupported,
  getSafeSelection,
  isValidRange,
  normalizeSelectedText,
  validateTextSelection,
} from './utils'

/**
 * Manages text selection events and provides a consistent interface
 * for capturing user text selections in article content
 */
export class SelectionManager {
  private container: HTMLElement
  private onSelection: SelectionCallback
  private options: SelectionManagerOptions
  private debounceTimer: NodeJS.Timeout | null = null
  private isActive = false

  constructor(
    container: HTMLElement,
    onSelection: SelectionCallback,
    options: SelectionManagerOptions = {}
  ) {
    // Check browser compatibility
    if (!isSelectionAPISupported()) {
      throw new Error('Selection API is not supported in this browser')
    }

    this.container = container
    this.onSelection = onSelection
    this.options = {
      debounceMs: 100,
      minSelectionLength: 1,
      maxSelectionLength: 5000,
      ...options,
    }

    this.setupListeners()
    this.isActive = true
  }

  /**
   * Set up event listeners for text selection
   */
  private setupListeners(): void {
    this.container.addEventListener('mouseup', this.handleMouseUp)
    this.container.addEventListener('touchend', this.handleTouchEnd)
    this.container.addEventListener('keyup', this.handleKeyUp)

    // Prevent text selection from interfering with our custom handling
    this.container.addEventListener('selectstart', this.handleSelectStart)
  }

  /**
   * Handle mouse up events
   */
  private handleMouseUp = (): void => {
    if (!this.isActive) return

    // Small delay to ensure selection is complete
    this.debounceSelection(() => {
      this.processCurrentSelection()
    })
  }

  /**
   * Handle touch end events for mobile devices
   */
  private handleTouchEnd = (): void => {
    if (!this.isActive) return

    this.debounceSelection(() => {
      this.processCurrentSelection()
    })
  }

  /**
   * Handle keyboard selection (Shift+Arrow keys, Ctrl+A, etc.)
   */
  private handleKeyUp = (event: KeyboardEvent): void => {
    if (!this.isActive) return

    // Only process if selection-related keys were pressed
    if (
      event.shiftKey ||
      (event.key === 'a' && (event.ctrlKey || event.metaKey))
    ) {
      this.debounceSelection(() => {
        this.processCurrentSelection()
      })
    }
  }

  /**
   * Allow text selection to proceed normally
   */
  private handleSelectStart = (): void => {
    // Don't prevent default - we want normal text selection behavior
    // This handler is just for future extensibility
  }

  /**
   * Debounce selection processing to avoid excessive calls
   */
  private debounceSelection(callback: () => void): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer)
    }

    this.debounceTimer = setTimeout(callback, this.options.debounceMs)
  }

  /**
   * Process the current browser selection
   */
  private processCurrentSelection(): void {
    const selection = getSafeSelection()

    if (!selection || selection.rangeCount === 0) {
      return
    }

    const selectedText = normalizeSelectedText(selection.toString())

    // Validate selection text
    const validation = validateTextSelection(
      selectedText,
      this.options.minSelectionLength,
      this.options.maxSelectionLength
    )

    if (!validation.isValid) {
      console.debug('Invalid selection:', validation.error)
      return
    }

    // Get and validate range
    let range: Range
    try {
      range = selection.getRangeAt(0)
    } catch (error) {
      console.warn('Error getting selection range:', error)
      return
    }

    if (!isValidRange(range)) {
      console.debug('Invalid range detected')
      return
    }

    // Only process selections within our container
    if (!this.isSelectionInContainer(range)) {
      return
    }

    this.processSelection(selection)
  }

  /**
   * Check if the selection is within our managed container
   */
  private isSelectionInContainer(range: Range): boolean {
    const commonAncestor = range.commonAncestorContainer

    // Check if the selection is within our container
    return (
      this.container.contains(commonAncestor) ||
      this.container === commonAncestor
    )
  }

  /**
   * Convert browser Selection to our TextSelection format and trigger callback
   */
  private processSelection(selection: Selection): void {
    try {
      const range = selection.getRangeAt(0)

      const textSelection: TextSelection = {
        text: selection.toString(),
        range: range.cloneRange(), // Clone to avoid issues with selection changes
        startContainer: range.startContainer,
        endContainer: range.endContainer,
        startOffset: range.startOffset,
        endOffset: range.endOffset,
      }

      this.onSelection(textSelection)
    } catch (error) {
      console.error('Error processing selection:', error)
    }
  }

  /**
   * Clear the current text selection
   */
  public clearSelection(): void {
    const selection = window.getSelection()
    if (selection) {
      selection.removeAllRanges()
    }
  }

  /**
   * Temporarily disable selection processing
   */
  public disable(): void {
    this.isActive = false
  }

  /**
   * Re-enable selection processing
   */
  public enable(): void {
    this.isActive = true
  }

  /**
   * Cleanup event listeners and resources
   */
  public destroy(): void {
    this.isActive = false

    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer)
    }

    this.container.removeEventListener('mouseup', this.handleMouseUp)
    this.container.removeEventListener('touchend', this.handleTouchEnd)
    this.container.removeEventListener('keyup', this.handleKeyUp)
    this.container.removeEventListener('selectstart', this.handleSelectStart)
  }
}
