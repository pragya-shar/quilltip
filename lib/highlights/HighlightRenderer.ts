import { Id } from '@/convex/_generated/dataModel'

export interface HighlightSegment {
  id: Id<'highlights'>
  text: string
  startOffset: number
  endOffset: number
  startContainerPath: string
  endContainerPath: string
  color: string
  note?: string
  isPublic: boolean
  userId: Id<'users'>
  userName?: string
  userAvatar?: string
}

export interface RenderedHighlight {
  id: Id<'highlights'>
  element: HTMLElement
  range: Range
  color: string
}

export class HighlightRenderer {
  private container: HTMLElement
  private highlights: Map<Id<'highlights'>, RenderedHighlight> = new Map()
  private storedSegments: HighlightSegment[] = [] // Store segments for reapply
  private observer: MutationObserver | null = null
  private isReapplying: boolean = false // Prevent recursive reapply

  constructor(container: HTMLElement) {
    this.container = container
    this.setupMutationObserver()
  }

  /**
   * Setup mutation observer to handle content changes
   */
  private setupMutationObserver() {
    this.observer = new MutationObserver(() => {
      // Re-render highlights if content changes
      this.reapplyHighlights()
    })

    this.observer.observe(this.container, {
      childList: true,
      subtree: true,
      characterData: true,
    })
  }

  /**
   * Apply highlights to the content
   */
  public applyHighlights(segments: HighlightSegment[]) {
    // Store segments for potential reapply after DOM changes
    this.storedSegments = segments

    // Clear existing highlights
    this.clearHighlights()

    // Sort segments by start offset to handle overlaps
    const sortedSegments = [...segments].sort(
      (a, b) => a.startOffset - b.startOffset
    )

    // Group overlapping highlights
    const highlightGroups = this.groupOverlappingHighlights(sortedSegments)

    // Apply each group of highlights
    highlightGroups.forEach((group) => {
      this.renderHighlightGroup(group)
    })
  }

  /**
   * Group overlapping highlights for proper rendering
   */
  private groupOverlappingHighlights(
    segments: HighlightSegment[]
  ): HighlightSegment[][] {
    const groups: HighlightSegment[][] = []
    let currentGroup: HighlightSegment[] = []
    let lastEnd = -1

    segments.forEach((segment) => {
      if (segment.startOffset > lastEnd) {
        // No overlap, start new group
        if (currentGroup.length > 0) {
          groups.push(currentGroup)
        }
        currentGroup = [segment]
      } else {
        // Overlap detected, add to current group
        currentGroup.push(segment)
      }
      lastEnd = Math.max(lastEnd, segment.endOffset)
    })

    if (currentGroup.length > 0) {
      groups.push(currentGroup)
    }

    return groups
  }

  /**
   * Render a group of overlapping highlights
   */
  private renderHighlightGroup(group: HighlightSegment[]) {
    if (group.length === 0) return

    // For overlapping highlights, create a composite highlight
    const primaryHighlight = group[0]
    if (!primaryHighlight) return

    const compositeColor = this.blendColors(group.map((h) => h.color))

    try {
      const range = this.createRangeFromSegment(primaryHighlight)
      if (!range) return

      // Create highlight wrapper element
      const highlightElement = this.createHighlightElement(
        primaryHighlight.id,
        compositeColor,
        group
      )

      // Wrap the range content with highlight element
      this.wrapRangeWithHighlight(range, highlightElement)

      // Store the rendered highlight
      this.highlights.set(primaryHighlight.id, {
        id: primaryHighlight.id,
        element: highlightElement,
        range,
        color: compositeColor,
      })
    } catch (error) {
      console.error('Error rendering highlight group:', error)
    }
  }

  /**
   * Create a Range object from a highlight segment
   */
  private createRangeFromSegment(segment: HighlightSegment): Range | null {
    try {
      const startNode = this.getNodeFromPath(segment.startContainerPath)
      const endNode = this.getNodeFromPath(segment.endContainerPath)

      if (!startNode || !endNode) {
        console.warn('Could not find nodes for highlight:', segment.id)
        return null
      }

      const range = document.createRange()
      range.setStart(startNode, segment.startOffset)
      range.setEnd(endNode, segment.endOffset)

      return range
    } catch (error) {
      console.error('Error creating range:', error)
      return null
    }
  }

  /**
   * Get a node from a path string
   */
  private getNodeFromPath(path: string): Node | null {
    const parts = path.split('/')
    let current: Node = this.container

    for (const part of parts) {
      if (part === '') continue

      const index = parseInt(part)
      if (isNaN(index)) {
        // Text node reference
        if (current.nodeType === Node.TEXT_NODE) {
          return current
        }
        continue
      }

      const children = Array.from(current.childNodes)
      if (index < children.length) {
        const nextNode = children[index]
        if (!nextNode) return null
        current = nextNode
      } else {
        return null
      }
    }

    return current
  }

  /**
   * Create a highlight element
   */
  private createHighlightElement(
    id: Id<'highlights'>,
    color: string,
    segments: HighlightSegment[]
  ): HTMLElement {
    const element = document.createElement('mark')
    element.className = 'text-highlight'
    element.dataset.highlightId = id
    element.style.backgroundColor = `${color}40`
    element.style.borderBottom = `2px solid ${color}`
    element.style.cursor = 'pointer'
    element.style.transition = 'background-color 0.2s'

    // Add hover effect
    element.addEventListener('mouseenter', () => {
      element.style.backgroundColor = `${color}60`
    })

    element.addEventListener('mouseleave', () => {
      element.style.backgroundColor = `${color}40`
    })

    // Add tooltip with user info
    if (segments.length > 0) {
      const tooltipText = segments
        .map(
          (s) => `${s.userName || 'Anonymous'}${s.note ? ': ' + s.note : ''}`
        )
        .join('\n')
      element.title = tooltipText
    }

    return element
  }

  /**
   * Wrap a range with a highlight element
   */
  private wrapRangeWithHighlight(range: Range, highlightElement: HTMLElement) {
    try {
      const contents = range.extractContents()
      highlightElement.appendChild(contents)
      range.insertNode(highlightElement)
    } catch (error) {
      console.error('Error wrapping range:', error)
    }
  }

  /**
   * Blend multiple colors for overlapping highlights
   */
  private blendColors(colors: string[]): string {
    if (colors.length === 0) return '#FFEB3B'
    if (colors.length === 1) return colors[0] || '#FFEB3B'

    // Simple color blending - take the first color with reduced opacity
    // In production, you might want more sophisticated blending
    return colors[0] || '#FFEB3B'
  }

  /**
   * Clear all highlights
   */
  public clearHighlights() {
    this.highlights.forEach((highlight) => {
      try {
        const parent = highlight.element.parentNode
        if (parent) {
          // Move children back to parent
          while (highlight.element.firstChild) {
            parent.insertBefore(highlight.element.firstChild, highlight.element)
          }
          parent.removeChild(highlight.element)
        }
      } catch (error) {
        console.error('Error clearing highlight:', error)
      }
    })

    this.highlights.clear()
  }

  /**
   * Reapply highlights after content change
   */
  private reapplyHighlights() {
    // Prevent recursive reapply (since applyHighlights modifies DOM)
    if (this.isReapplying || this.storedSegments.length === 0) {
      return
    }

    this.isReapplying = true
    try {
      // Clear existing highlights
      this.clearHighlights()

      // Sort and reapply stored segments
      const sortedSegments = [...this.storedSegments].sort(
        (a, b) => a.startOffset - b.startOffset
      )
      const highlightGroups = this.groupOverlappingHighlights(sortedSegments)

      highlightGroups.forEach((group) => {
        this.renderHighlightGroup(group)
      })
    } finally {
      this.isReapplying = false
    }
  }

  /**
   * Find highlight by position
   */
  public getHighlightAtPosition(x: number, y: number): Id<'highlights'> | null {
    const element = document.elementFromPoint(x, y)
    if (!element) return null

    const highlightElement = element.closest('[data-highlight-id]')
    if (!highlightElement) return null

    return highlightElement.getAttribute(
      'data-highlight-id'
    ) as Id<'highlights'>
  }

  /**
   * Scroll to a specific highlight
   */
  public scrollToHighlight(highlightId: Id<'highlights'>) {
    const highlight = this.highlights.get(highlightId)
    if (!highlight) return

    highlight.element.scrollIntoView({
      behavior: 'smooth',
      block: 'center',
    })

    // Flash animation
    const originalBg = highlight.element.style.backgroundColor
    highlight.element.style.backgroundColor = `${highlight.color}80`
    setTimeout(() => {
      highlight.element.style.backgroundColor = originalBg
    }, 500)
  }

  /**
   * Destroy the renderer and clean up
   */
  public destroy() {
    this.clearHighlights()
    if (this.observer) {
      this.observer.disconnect()
      this.observer = null
    }
  }
}
