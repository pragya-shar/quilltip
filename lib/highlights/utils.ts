/**
 * Utility functions for handling text selections and browser compatibility
 */

/**
 * Check if the Selection API is supported in the current browser
 */
export function isSelectionAPISupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.getSelection !== 'undefined' &&
    typeof document.createRange !== 'undefined'
  )
}

/**
 * Safely get the current selection, handling cross-browser differences
 */
export function getSafeSelection(): Selection | null {
  if (!isSelectionAPISupported()) {
    return null
  }

  try {
    return window.getSelection()
  } catch (error) {
    console.warn('Error getting selection:', error)
    return null
  }
}

/**
 * Check if a range is valid and can be used safely
 */
export function isValidRange(range: Range): boolean {
  try {
    // Basic validation
    if (!range || !range.startContainer || !range.endContainer) {
      return false
    }

    // Check if start comes before end
    const comparison = range.compareBoundaryPoints(Range.START_TO_END, range)
    if (comparison > 0) {
      return false
    }

    // Check if the range has content
    return range.toString().trim().length > 0
  } catch (error) {
    console.warn('Error validating range:', error)
    return false
  }
}

/**
 * Normalize text content by removing extra whitespace
 */
export function normalizeSelectedText(text: string): string {
  return text.trim().replace(/\s+/g, ' ')
}

/**
 * Validate if a text selection meets basic requirements
 */
export function validateTextSelection(
  text: string,
  minLength = 1,
  maxLength = 5000
): { isValid: boolean; error?: string } {
  const normalizedText = normalizeSelectedText(text)

  if (normalizedText.length < minLength) {
    return {
      isValid: false,
      error: `Selection too short (minimum ${minLength} characters)`,
    }
  }

  if (normalizedText.length > maxLength) {
    return {
      isValid: false,
      error: `Selection too long (maximum ${maxLength} characters)`,
    }
  }

  // Check for only whitespace
  if (normalizedText.length === 0) {
    return {
      isValid: false,
      error: 'Selection contains only whitespace',
    }
  }

  return { isValid: true }
}
