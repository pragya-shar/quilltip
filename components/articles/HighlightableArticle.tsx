'use client'

import { useEffect, useState, useCallback, useRef } from 'react'
import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Underline from '@tiptap/extension-underline'
import Link from '@tiptap/extension-link'
import CodeBlockLowlight from '@tiptap/extension-code-block-lowlight'
import { lowlight } from '@/lib/lowlight'
import { ResizableImage } from '@/components/editor/extensions/ResizableImage'
import HighlightExtension from '@/components/editor/extensions/HighlightExtension'
import { EditorKeymap } from '@/components/editor/extensions/EditorKeymap'
import { HighlightConverter } from '@/lib/highlights/HighlightConverter'
import { useMutation } from 'convex/react'
import { api } from '@/convex/_generated/api'
import { useArticleById, useArticleHighlightsQuery } from '@/hooks/convex'
import type { Id } from '@/types/convex'
import { HighlightPopover } from '@/components/highlights/HighlightPopover'
import { HighlightDetailsPanel } from '@/components/highlights/HighlightDetailsPanel'
import { cn } from '@/lib/utils'
import { JSONContent } from '@tiptap/react'
import { AnimatePresence } from 'motion/react'
import { useAuth } from '@/components/providers/AuthContext'
import { toast } from 'sonner'
import { EDITOR_PROSE_CLASS } from '@/lib/constants'

interface HighlightData {
  _id: Id<'highlights'>
  text: string
  startOffset: number
  endOffset: number
  startContainerPath: string
  endContainerPath: string
  highlightId: string
  color?: string
  note?: string
  isPublic: boolean
  userId: Id<'users'>
  userName?: string
  userAvatar?: string
  createdAt: number
}

interface HighlightableArticleProps {
  articleId: Id<'articles'>
  content: JSONContent
  editable?: boolean
  showHighlights?: boolean
  onHighlightClick?: (highlight: HighlightData) => void
  className?: string
}

export function HighlightableArticle({
  articleId,
  content,
  editable = false,
  showHighlights = true,
  onHighlightClick,
  className,
}: HighlightableArticleProps) {
  const [selectedText, setSelectedText] = useState<{
    text: string
    from: number
    to: number
  } | null>(null)
  const [popoverPosition, setPopoverPosition] = useState<{
    top: number
    left: number
  } | null>(null)
  const [highlightTooltip, setHighlightTooltip] = useState<{
    highlight: HighlightData
    position: { top: number; left: number }
  } | null>(null)
  const editorRef = useRef<HTMLDivElement>(null)
  const isApplyingHighlightsRef = useRef(false)
  // Tracks whether the user is in the middle of a mouse/touch drag-select.
  // During a drag, onSelectionUpdate fires on every move; if we let it mount
  // the popover at 3 chars, HighlightPopover's FocusScope trap steals focus
  // from the article body and the native selection collapses, capping
  // selections at 3 characters. Defer popover display to pointerup instead.
  const isDraggingRef = useRef(false)

  // Get current user for ownership checks
  const { user } = useAuth()

  // Fetch article data (for author info, Stellar address, etc.)
  const article = useArticleById(articleId)

  const highlights = useArticleHighlightsQuery(articleId)

  // Use ref to avoid stale closure in onHighlightClick callback
  const highlightsRef = useRef(highlights)
  useEffect(() => {
    highlightsRef.current = highlights
  }, [highlights])

  // Mutation to create a highlight
  const createHighlight = useMutation(api.highlights.createHighlight)

  // Initialize TipTap editor with highlight extension
  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        // StarterKit v3 ships codeBlock, link, and underline by default; we
        // register customised versions of each below, so disable them here
        // to avoid duplicate-extension warnings.
        codeBlock: false,
        link: false,
        underline: false,
      }),
      Underline,
      Link.configure({
        openOnClick: false,
      }),
      CodeBlockLowlight.configure({
        lowlight,
      }),
      ResizableImage,
      ...(editable ? [EditorKeymap] : []),
      HighlightExtension.configure({
        multicolor: true,
        highlights:
          highlights?.map((h) => ({
            id: h._id,
            color: h.color || '#FFEB3B',
            userId: h.userId,
            userName: h.userName,
            userAvatar: h.userAvatar,
            note: h.note,
            createdAt: h.createdAt,
          })) || [],
        onHighlightClick: (highlightAttrs, event) => {
          // Use ref to get current highlights (avoids stale closure)
          const currentHighlights = highlightsRef.current

          // Find the full highlight data with defensive lookup
          // Try matching by _id first (correct way)
          let fullHighlight = currentHighlights?.find(
            (h) => h._id === highlightAttrs.id
          )

          // Fallback: try matching by highlightId for backwards compatibility
          if (!fullHighlight && highlightAttrs.id) {
            fullHighlight = currentHighlights?.find(
              (h) => h.highlightId === highlightAttrs.id
            )
          }

          if (fullHighlight) {
            // Show tooltip with highlight info
            if (onHighlightClick) {
              onHighlightClick(fullHighlight)
            } else {
              // Default behavior: show tooltip using click event position
              const target = event.target as HTMLElement
              const rect = target.getBoundingClientRect()
              setHighlightTooltip({
                highlight: fullHighlight,
                position: {
                  top: rect.top - 10,
                  left: rect.left + rect.width / 2,
                },
              })
            }
          }
        },
      }),
    ],
    content,
    editable,
    immediatelyRender: false,
    editorProps: {
      attributes: {
        class: `${EDITOR_PROSE_CLASS} prose-stone`,
      },
    },
    onSelectionUpdate: ({ editor }) => {
      if (editable || isApplyingHighlightsRef.current) return
      // During active mouse/touch drag, defer popover creation to pointerup.
      // Keyboard selection (shift+arrow, ctrl+a) still runs this path.
      if (isDraggingRef.current) return

      const { selection } = editor.state
      const { from, to } = selection
      const text = editor.state.doc.textBetween(from, to, ' ')

      if (text.trim().length >= 3) {
        // Get the DOM selection for positioning
        const domSelection = window.getSelection()
        if (domSelection && domSelection.rangeCount > 0) {
          const range = domSelection.getRangeAt(0)
          const rect = range.getBoundingClientRect()
          const containerRect = editorRef.current?.getBoundingClientRect()

          setSelectedText({ text, from, to })
          if (containerRect) {
            setPopoverPosition({
              top: rect.top - containerRect.top - 60,
              left: rect.left - containerRect.left + rect.width / 2,
            })
          }
        }
      } else {
        setSelectedText(null)
        setPopoverPosition(null)
      }
    },
  })

  // Apply highlights when they change
  useEffect(() => {
    if (!editor || !highlights || !showHighlights) return

    // Flag to suppress popover during programmatic highlight application
    isApplyingHighlightsRef.current = true
    HighlightConverter.applyHighlightsToEditor(editor, highlights)
    // Use requestAnimationFrame to clear flag after all selection events have fired
    requestAnimationFrame(() => {
      isApplyingHighlightsRef.current = false
    })
  }, [editor, highlights, showHighlights])

  // Show the highlight popover only after the user releases a drag-select.
  // Mounting it mid-drag traps focus and collapses the selection.
  useEffect(() => {
    const container = editorRef.current
    if (!container || editable) return

    const handlePointerDown = (e: MouseEvent | TouchEvent) => {
      const target = e.target as HTMLElement | null
      // Ignore events originating from an open popover/details dialog so
      // their own buttons still receive the click.
      if (target?.closest('[role="dialog"]')) return
      isDraggingRef.current = true
      setSelectedText(null)
      setPopoverPosition(null)
    }

    const handlePointerUp = () => {
      if (!isDraggingRef.current) return
      isDraggingRef.current = false
      // Defer one tick so the browser and Tiptap commit the final selection.
      setTimeout(() => {
        if (!editor) return
        const { from, to } = editor.state.selection
        const text = editor.state.doc.textBetween(from, to, ' ')
        if (text.trim().length < 3) return
        const domSelection = window.getSelection()
        if (!domSelection || domSelection.rangeCount === 0) return
        const range = domSelection.getRangeAt(0)
        const rect = range.getBoundingClientRect()
        const containerRect = editorRef.current?.getBoundingClientRect()
        if (!containerRect) return
        setSelectedText({ text, from, to })
        setPopoverPosition({
          top: rect.top - containerRect.top - 60,
          left: rect.left - containerRect.left + rect.width / 2,
        })
      }, 0)
    }

    container.addEventListener('mousedown', handlePointerDown)
    container.addEventListener('touchstart', handlePointerDown, {
      passive: true,
    })
    document.addEventListener('mouseup', handlePointerUp)
    document.addEventListener('touchend', handlePointerUp)

    return () => {
      container.removeEventListener('mousedown', handlePointerDown)
      container.removeEventListener('touchstart', handlePointerDown)
      document.removeEventListener('mouseup', handlePointerUp)
      document.removeEventListener('touchend', handlePointerUp)
    }
  }, [editor, editable])

  // Handle highlight creation
  const handleCreateHighlight = useCallback(
    async (color: string, note?: string, isPublic: boolean = true) => {
      if (!selectedText || !editor) return

      try {
        // Create highlight data from selection
        const highlightData = HighlightConverter.createHighlightFromSelection(
          editor,
          {
            color,
            note,
            isPublic,
          }
        )

        if (highlightData) {
          // Save to database and get the new highlight ID
          await createHighlight({
            articleId,
            ...highlightData,
          })

          // Clear selection immediately for better UX
          setSelectedText(null)
          setPopoverPosition(null)
          window.getSelection()?.removeAllRanges()

          // Note: The highlight will be applied automatically when the
          // highlights query refetches (due to Convex reactivity)
          // No need to manually apply a temporary highlight
        }
      } catch (error) {
        console.error('Error creating highlight:', error)
        toast.error('Failed to create highlight', {
          description:
            error instanceof Error
              ? error.message
              : 'Please try again or refresh the page.',
        })
      }
    },
    [selectedText, editor, articleId, createHighlight]
  )

  const handlePopoverClose = useCallback(() => {
    setSelectedText(null)
    setPopoverPosition(null)
    window.getSelection()?.removeAllRanges()
    editor?.commands.focus()
  }, [editor])

  const handleTooltipClose = useCallback(() => {
    setHighlightTooltip(null)
    editor?.commands.focus()
  }, [editor])

  useEffect(() => {
    const hasCreationPopover = Boolean(popoverPosition && selectedText)
    const hasDetailsPanel = highlightTooltip !== null
    if (!hasCreationPopover && !hasDetailsPanel) return

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.preventDefault()
      e.stopPropagation()
      if (hasCreationPopover) {
        handlePopoverClose()
      } else if (hasDetailsPanel) {
        handleTooltipClose()
      }
    }

    document.addEventListener('keydown', onKeyDown, true)
    return () => document.removeEventListener('keydown', onKeyDown, true)
  }, [
    popoverPosition,
    selectedText,
    highlightTooltip,
    handlePopoverClose,
    handleTooltipClose,
  ])

  return (
    <div
      className={cn('highlightable-article relative', className)}
      ref={editorRef}
    >
      <EditorContent editor={editor} />

      {/* Highlight creation popover */}
      <AnimatePresence>
        {popoverPosition && selectedText && article && (
          <HighlightPopover
            position={popoverPosition}
            onCreateHighlight={handleCreateHighlight}
            onClose={handlePopoverClose}
            selectedText={selectedText.text}
            articleId={articleId}
            articleSlug={article.slug}
            authorName={article.author?.name || article.authorName || 'Author'}
            authorStellarAddress={article.author?.stellarAddress}
            startOffset={selectedText.from}
            endOffset={selectedText.to}
          />
        )}
      </AnimatePresence>

      {/* Highlight details panel */}
      <AnimatePresence>
        {highlightTooltip && article && (
          <HighlightDetailsPanel
            highlight={highlightTooltip.highlight}
            position={highlightTooltip.position}
            onClose={handleTooltipClose}
            currentUserId={user?._id as Id<'users'> | undefined}
            articleId={articleId}
            articleSlug={article.slug}
            authorName={article.author?.name || article.authorName || 'Author'}
            authorStellarAddress={article.author?.stellarAddress}
          />
        )}
      </AnimatePresence>
    </div>
  )
}
