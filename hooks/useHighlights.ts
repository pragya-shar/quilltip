import { useState, useEffect, useCallback, useRef } from 'react'
import { useQuery, useMutation } from 'convex/react'
import { api } from '@/convex/_generated/api'
import { Id } from '@/convex/_generated/dataModel'
import { SelectionManager } from '@/lib/highlights/SelectionManager'
import { HighlightSerializer } from '@/lib/highlights/HighlightSerializer'
import {
  HighlightRenderer,
  HighlightSegment,
} from '@/lib/highlights/HighlightRenderer'

export interface UseHighlightsOptions {
  articleId: Id<'articles'>
  containerRef: React.RefObject<HTMLElement>
  enabled?: boolean
  onHighlightCreated?: (highlightId: Id<'highlights'>) => void
  onHighlightDeleted?: (highlightId: Id<'highlights'>) => void
  onHighlightUpdated?: (highlightId: Id<'highlights'>) => void
}

export interface HighlightSelection {
  text: string
  startOffset: number
  endOffset: number
  startPath: string
  endPath: string
  range: Range
}

export function useHighlights({
  articleId,
  containerRef,
  enabled = true,
  onHighlightCreated,
  onHighlightDeleted,
  onHighlightUpdated,
}: UseHighlightsOptions) {
  const [selection, setSelection] = useState<HighlightSelection | null>(null)
  const [popoverPosition, setPopoverPosition] = useState<{
    top: number
    left: number
  } | null>(null)
  const [isCreating, setIsCreating] = useState(false)
  const [activeHighlight, setActiveHighlight] =
    useState<Id<'highlights'> | null>(null)

  const selectionManagerRef = useRef<SelectionManager | null>(null)
  const rendererRef = useRef<HighlightRenderer | null>(null)

  // Fetch highlights
  const highlights = useQuery(
    api.highlights.getArticleHighlights,
    enabled ? { articleId } : 'skip'
  )

  // Mutations
  const createHighlight = useMutation(api.highlights.createHighlight)
  const updateHighlight = useMutation(api.highlights.updateHighlight)
  const deleteHighlight = useMutation(api.highlights.deleteHighlight)

  // Initialize selection manager
  useEffect(() => {
    if (!containerRef.current || !enabled) return

    const manager = new SelectionManager(
      containerRef.current,
      (textSelection) => {
        const rect = textSelection.range.getBoundingClientRect()

        setSelection({
          text: textSelection.text,
          startOffset: textSelection.startOffset,
          endOffset: textSelection.endOffset,
          startPath: HighlightSerializer.getNodePath(
            textSelection.startContainer
          ),
          endPath: HighlightSerializer.getNodePath(textSelection.endContainer),
          range: textSelection.range,
        })

        setPopoverPosition({
          top: rect.top + window.scrollY - 60,
          left: rect.left + rect.width / 2,
        })
      },
      {
        minSelectionLength: 3,
        maxSelectionLength: 5000,
        debounceMs: 300,
      }
    )

    selectionManagerRef.current = manager

    return () => {
      manager.destroy()
      selectionManagerRef.current = null
    }
  }, [containerRef, enabled])

  // Initialize highlight renderer
  useEffect(() => {
    if (!containerRef.current || !enabled) return

    const renderer = new HighlightRenderer(containerRef.current)
    rendererRef.current = renderer

    return () => {
      renderer.destroy()
      rendererRef.current = null
    }
  }, [containerRef, enabled])

  // Clear selection
  const clearSelection = useCallback(() => {
    setSelection(null)
    setPopoverPosition(null)
    window.getSelection()?.removeAllRanges()
    selectionManagerRef.current?.clearSelection()
  }, [])

  // Apply highlights when they change
  useEffect(() => {
    if (!rendererRef.current || !highlights) return

    const segments: HighlightSegment[] = highlights.map((h) => ({
      id: h._id,
      text: h.text,
      startOffset: h.startOffset,
      endOffset: h.endOffset,
      startContainerPath: h.startContainerPath,
      endContainerPath: h.endContainerPath,
      color: h.color || '#FFEB3B',
      note: h.note,
      isPublic: h.isPublic,
      userId: h.userId,
      userName: h.userName,
      userAvatar: h.userAvatar,
    }))

    rendererRef.current.applyHighlights(segments)
  }, [highlights])

  // Create highlight
  const handleCreateHighlight = useCallback(
    async (color: string, note?: string, isPublic: boolean = true) => {
      if (!selection || isCreating) return

      setIsCreating(true)

      try {
        const highlightId = await createHighlight({
          articleId,
          text: selection.text,
          startOffset: selection.startOffset,
          endOffset: selection.endOffset,
          startContainerPath: selection.startPath,
          endContainerPath: selection.endPath,
          color,
          note,
          isPublic,
        })

        onHighlightCreated?.(highlightId)

        // Clear selection
        clearSelection()
      } catch (error) {
        console.error('Error creating highlight:', error)
      } finally {
        setIsCreating(false)
      }
    },
    [
      selection,
      isCreating,
      articleId,
      createHighlight,
      onHighlightCreated,
      clearSelection,
    ]
  )

  // Update highlight
  const handleUpdateHighlight = useCallback(
    async (
      highlightId: Id<'highlights'>,
      updates: {
        color?: string
        note?: string
        isPublic?: boolean
      }
    ) => {
      try {
        await updateHighlight({
          id: highlightId,
          ...updates,
        })

        onHighlightUpdated?.(highlightId)
      } catch (error) {
        console.error('Error updating highlight:', error)
      }
    },
    [updateHighlight, onHighlightUpdated]
  )

  // Delete highlight
  const handleDeleteHighlight = useCallback(
    async (highlightId: Id<'highlights'>) => {
      try {
        await deleteHighlight({ id: highlightId })
        onHighlightDeleted?.(highlightId)
      } catch (error) {
        console.error('Error deleting highlight:', error)
      }
    },
    [deleteHighlight, onHighlightDeleted]
  )

  // Scroll to highlight
  const scrollToHighlight = useCallback((highlightId: Id<'highlights'>) => {
    rendererRef.current?.scrollToHighlight(highlightId)
    setActiveHighlight(highlightId)

    // Clear active highlight after animation
    setTimeout(() => {
      setActiveHighlight(null)
    }, 2000)
  }, [])

  // Get highlight at position
  const getHighlightAtPosition = useCallback((x: number, y: number) => {
    return rendererRef.current?.getHighlightAtPosition(x, y) || null
  }, [])

  return {
    // State
    highlights: highlights || [],
    selection,
    popoverPosition,
    isCreating,
    activeHighlight,

    // Actions
    createHighlight: handleCreateHighlight,
    updateHighlight: handleUpdateHighlight,
    deleteHighlight: handleDeleteHighlight,
    clearSelection,
    scrollToHighlight,
    getHighlightAtPosition,

    // Refs
    selectionManager: selectionManagerRef.current,
    renderer: rendererRef.current,
  }
}

/**
 * Hook specifically for managing article highlights display
 */
export function useArticleHighlights(articleId: Id<'articles'>) {
  const highlights = useQuery(api.highlights.getArticleHighlights, {
    articleId,
  })

  const publicHighlights = highlights?.filter((h) => h.isPublic) || []
  const highlightCount = highlights?.length || 0
  const uniqueUsers = new Set(highlights?.map((h) => h.userId) || []).size

  return {
    highlights: highlights || [],
    publicHighlights,
    highlightCount,
    uniqueUsers,
  }
}

/**
 * Hook for managing user's highlights across all articles
 */
export function useUserHighlights(userId?: Id<'users'>) {
  const highlights = useQuery(
    api.highlights.getUserHighlights,
    userId ? { userId } : 'skip'
  )

  // Group highlights by article
  const highlightsByArticle =
    highlights?.reduce(
      (acc, highlight) => {
        const articleId = highlight.articleId
        if (!acc[articleId]) {
          acc[articleId] = []
        }
        acc[articleId].push(highlight)
        return acc
      },
      {} as Record<string, typeof highlights>
    ) || {}

  return {
    highlights: highlights || [],
    highlightsByArticle,
    totalHighlights: highlights?.length || 0,
  }
}
