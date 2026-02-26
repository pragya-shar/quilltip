import { TextSelection, SerializedHighlight } from './types'

/**
 * HighlightSerializer class for converting text selections to persistent format
 * and restoring them from saved data.
 *
 * This implementation follows the Phase 2 specification for Week 5 Day 3-4
 */
export class HighlightSerializer {
  /**
   * Serialize a text selection into a persistent format that can be stored
   * @param selection - The text selection to serialize
   * @param articleId - The ID of the article containing the selection
   * @returns SerializedHighlight object ready for storage
   */
  static serialize(
    selection: TextSelection,
    articleId: string
  ): SerializedHighlight {
    const startPath = this.getNodePath(selection.startContainer)
    const endPath = this.getNodePath(selection.endContainer)

    return {
      articleId,
      text: selection.text,
      startOffset: selection.startOffset,
      endOffset: selection.endOffset,
      startNode: startPath,
      endNode: endPath,
    }
  }

  /**
   * Deserialize a stored highlight back into a Range object
   * @param highlight - The serialized highlight to restore
   * @returns Range object or null if the highlight cannot be restored
   */
  static deserialize(highlight: SerializedHighlight): Range | null {
    try {
      const startNode = this.getNodeFromPath(highlight.startNode)
      const endNode = this.getNodeFromPath(highlight.endNode)

      if (!startNode || !endNode) {
        console.warn('Could not find nodes for highlight restoration')
        return null
      }

      // Validate that the nodes can accept the specified offsets
      const startNodeLength =
        startNode.nodeType === Node.TEXT_NODE
          ? startNode.textContent?.length || 0
          : startNode.childNodes.length
      const endNodeLength =
        endNode.nodeType === Node.TEXT_NODE
          ? endNode.textContent?.length || 0
          : endNode.childNodes.length

      if (
        highlight.startOffset > startNodeLength ||
        highlight.endOffset > endNodeLength
      ) {
        console.warn('Offset out of bounds for highlight restoration')
        return null
      }

      const range = document.createRange()
      range.setStart(startNode, highlight.startOffset)
      range.setEnd(endNode, highlight.endOffset)

      return range
    } catch (error) {
      console.error('Failed to deserialize highlight:', error)
      return null
    }
  }

  /**
   * Generate a path string representing the location of a node in the DOM tree
   * @param node - The node to generate a path for
   * @returns Path string using dot-separated indices (e.g., "0.2.1.3")
   */
  static getNodePath(node: Node): string {
    const path: number[] = []
    let current: Node | null = node

    // Traverse up the DOM tree until we reach the document body
    while (current && current.parentNode && current !== document.body) {
      const parent: ParentNode = current.parentNode
      const index = Array.from(parent.childNodes).indexOf(current as ChildNode)

      if (index === -1) {
        console.warn('Node not found in parent childNodes')
        break
      }

      path.unshift(index)
      current = parent
    }

    return path.join('.')
  }

  /**
   * Find a node in the DOM tree using a path string
   * @param path - The path string (e.g., "0.2.1.3")
   * @returns The node at the specified path or null if not found
   */
  static getNodeFromPath(path: string): Node | null {
    if (!path) {
      return null
    }

    const indices = path.split('.').map(Number)

    // Start from document.body
    let current: Node = document.body

    for (const index of indices) {
      if (
        isNaN(index) ||
        index < 0 ||
        !current.childNodes ||
        index >= current.childNodes.length
      ) {
        return null
      }
      const nextNode = current.childNodes[index]
      if (!nextNode) {
        return null
      }
      current = nextNode
    }

    return current
  }

  /**
   * Save a highlight to persistent storage (localStorage + future API)
   * @param highlight - The serialized highlight to save
   */
  static async saveHighlight(highlight: SerializedHighlight): Promise<void> {
    try {
      // Get existing highlights from localStorage
      const stored = localStorage.getItem('quilltip_highlights')
      const highlights: SerializedHighlight[] = stored ? JSON.parse(stored) : []

      // Add new highlight with a timestamp
      const highlightWithMeta = {
        ...highlight,
        id: `highlight_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`,
        createdAt: new Date().toISOString(),
      }

      highlights.push(highlightWithMeta)

      // Save back to localStorage
      localStorage.setItem('quilltip_highlights', JSON.stringify(highlights))

      // TODO: In future, also save to API endpoint
      // await fetch('/api/highlights', {
      //   method: 'POST',
      //   headers: { 'Content-Type': 'application/json' },
      //   body: JSON.stringify(highlight)
      // });
    } catch (error) {
      console.error('Failed to save highlight:', error)
      throw error
    }
  }

  /**
   * Load all highlights for a specific article
   * @param articleId - The ID of the article to load highlights for
   * @returns Array of serialized highlights
   */
  static async loadHighlights(
    articleId: string
  ): Promise<SerializedHighlight[]> {
    try {
      // Load from localStorage
      const stored = localStorage.getItem('quilltip_highlights')
      const allHighlights: SerializedHighlight[] = stored
        ? JSON.parse(stored)
        : []

      // Filter highlights for this article
      const articleHighlights = allHighlights.filter(
        (h) => h.articleId === articleId
      )

      // TODO: In future, also load from API
      // const response = await fetch(`/api/highlights/article/${articleId}`);
      // const serverHighlights = await response.json();
      // return this.mergeHighlights(articleHighlights, serverHighlights);

      return articleHighlights
    } catch (error) {
      console.error('Failed to load highlights:', error)
      return []
    }
  }

  /**
   * Delete a highlight from storage
   * @param highlightId - The ID of the highlight to delete
   */
  static async deleteHighlight(highlightId: string): Promise<void> {
    try {
      // Remove from localStorage
      const stored = localStorage.getItem('quilltip_highlights')
      const highlights: SerializedHighlight[] = stored ? JSON.parse(stored) : []

      const filtered = highlights.filter((h) => h.id !== highlightId)
      localStorage.setItem('quilltip_highlights', JSON.stringify(filtered))

      // TODO: In future, also delete from API
      // await fetch(`/api/highlights/${highlightId}`, {
      //   method: 'DELETE'
      // });
    } catch (error) {
      console.error('Failed to delete highlight:', error)
      throw error
    }
  }
}
