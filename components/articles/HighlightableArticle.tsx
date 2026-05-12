'use client'

import { useEffect, useState, useCallback, useRef } from 'react'
import { useEditor, EditorContent, type JSONContent } from '@tiptap/react'
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
import { AnimatePresence } from 'motion/react'
import { useAuth } from '@/components/providers/AuthContext'
import { toast } from 'sonner'
import { EDITOR_PROSE_CLASS } from '@/lib/constants'
import { getRangeBoundingBox } from '@/lib/highlights/utils'
import type { TocHeading } from '@/lib/tiptap/headings'
import { useEnsureHeadingIds } from '@/components/articles/useEnsureHeadingIds'

function getRangeTopCenterAnchor(
  range: Range
): { top: number; left: number } | null {
  const box = getRangeBoundingBox(range)
  if (!box) return null
  return {
    top: box.top,
    left: box.left + box.width / 2,
  }
}

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
  tocHeadings?: TocHeading[]
}

export function HighlightableArticle({
  articleId,
  content,
  editable = false,
  showHighlights = true,
  onHighlightClick,
  className,
  tocHeadings = [],
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
  // During a drag, onSelectionUpdate fires on every move; if we mount the
  // popover at 3 chars, HighlightPopover's FocusScope trap steals focus from
  // the article body and the native selection collapses. Defer popover to pointerup.
  const isDraggingRef = useRef(false)

  const { user } = useAuth()

  useEnsureHeadingIds(tocHeadings, { rootSelector: '.highlightable-article' })
  const article = useArticleById(articleId)

  const highlights = useArticleHighlightsQuery(articleId, showHighlights)

  const highlightsRef = useRef(highlights)
  useEffect(() => {
    highlightsRef.current = highlights
  }, [highlights])

  const createHighlight = useMutation(api.highlights.createHighlight)

  const editor = useEditor(
    {
      extensions: [
        StarterKit.configure({
          // StarterKit v3 ships codeBlock, link, and underline by default; we
          // register customised versions below, so disable them here.
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
        ...(showHighlights
          ? [
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
                  const currentHighlights = highlightsRef.current

                  let fullHighlight = currentHighlights?.find(
                    (h) => h._id === highlightAttrs.id
                  )

                  if (!fullHighlight && highlightAttrs.id) {
                    fullHighlight = currentHighlights?.find(
                      (h) => h.highlightId === highlightAttrs.id
                    )
                  }

                  if (fullHighlight) {
                    if (onHighlightClick) {
                      onHighlightClick(fullHighlight)
                    } else {
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
            ]
          : []),
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
        if (!showHighlights) return
        // Keyboard selection (shift+arrow, ctrl+a) still runs this path.
        if (isDraggingRef.current) return

        const { selection } = editor.state
        const { from, to } = selection
        const text = editor.state.doc.textBetween(from, to, ' ')

        if (text.trim().length >= 3) {
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
    },
    [showHighlights, editable, articleId]
  )

  useEffect(() => {
    if (!showHighlights) {
      setSelectedText(null)
      setPopoverPosition(null)
      setHighlightTooltip(null)
    }
  }, [showHighlights])
  useEffect(() => {
    if (!editor || !highlights || !showHighlights) return

    // Suppress popover during programmatic highlight application
    isApplyingHighlightsRef.current = true
    HighlightConverter.applyHighlightsToEditor(editor, highlights)
    // Clear flag after selection events from apply have fired
    requestAnimationFrame(() => {
      isApplyingHighlightsRef.current = false
    })
  }, [editor, highlights, showHighlights])

  // Show the highlight popover only after the user releases a drag-select.
  useEffect(() => {
    const container = editorRef.current
    if (!container || editable || !showHighlights) return

    const handlePointerDown = (e: MouseEvent | TouchEvent) => {
      const target = e.target as HTMLElement | null
      // Ignore events from an open popover/dialog so their buttons still click.
      if (target?.closest('[role="dialog"]')) return
      isDraggingRef.current = true
      setSelectedText(null)
      setPopoverPosition(null)
    }

    const handlePointerUp = () => {
      if (!isDraggingRef.current) return
      isDraggingRef.current = false
      // Defer one frame so the browser and Tiptap commit the final selection.
      requestAnimationFrame(() => {
        if (!editor) return
        const { from, to } = editor.state.selection
        const text = editor.state.doc.textBetween(from, to, ' ')
        if (text.trim().length < 3) return
        const domSelection = window.getSelection()
        if (!domSelection || domSelection.rangeCount === 0) return
        const range = domSelection.getRangeAt(0)
        const anchor = getRangeTopCenterAnchor(range)
        if (!anchor) return
        setSelectedText({ text, from, to })
        setPopoverPosition({
          // Viewport coordinates (HighlightPopover is `position: fixed`).
          // Anchor at top-center of the selection bounding box.
          top: anchor.top,
          left: anchor.left,
        })
      })
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
  }, [editor, editable, showHighlights])

  const handleCreateHighlight = useCallback(
    async (color: string, note?: string, isPublic: boolean = true) => {
      if (!selectedText || !editor) return

      try {
        const highlightData = HighlightConverter.createHighlightFromSelection(
          editor,
          {
            color,
            note,
            isPublic,
          }
        )

        if (highlightData) {
          await createHighlight({
            articleId,
            ...highlightData,
          })

          setSelectedText(null)
          setPopoverPosition(null)
          window.getSelection()?.removeAllRanges()
          // Highlights re-apply when the Convex query refetches.
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
    if (editor) {
      const { from, to } = editor.state.selection
      if (from !== to) {
        editor.chain().setTextSelection(from).run()
      }
    }
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
    if (highlightTooltip === null) return

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.preventDefault()
      e.stopPropagation()
      handleTooltipClose()
    }

    document.addEventListener('keydown', onKeyDown, true)
    return () => document.removeEventListener('keydown', onKeyDown, true)
  }, [highlightTooltip, handleTooltipClose])

  return (
    <div
      className={cn('highlightable-article relative', className)}
      ref={editorRef}
    >
      <EditorContent editor={editor} />

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
