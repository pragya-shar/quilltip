'use client'

import { useEffect, useState, useCallback, useRef } from 'react'
import { usePathname, useSearchParams } from 'next/navigation'
import {
  useEditor,
  EditorContent,
  type Editor,
  type JSONContent,
} from '@tiptap/react'
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
import { HighlightSignInPrompt } from '@/components/highlights/HighlightSignInPrompt'
import { HighlightDetailsPanel } from '@/components/highlights/HighlightDetailsPanel'
import { cn } from '@/lib/utils'
import { AnimatePresence } from 'motion/react'
import { useAuth } from '@/components/providers/AuthContext'
import { toast } from 'sonner'
import { EDITOR_PROSE_CLASS } from '@/lib/constants'
import { handleArticleHighlightOverlayPointerDown } from '@/lib/highlights/articleOverlayPointerDismiss'
import { getRangeTopCenterAnchor } from '@/lib/highlights/utils'
import {
  applyPendingHighlightToEditor,
  readPendingHighlightPopoverAnchor,
  shouldKeepTryingHighlightSelectionResume,
} from '@/lib/highlight/resumePendingHighlightSelection'
import type { TocHeading } from '@/lib/tiptap/headings'
import { useEnsureHeadingIds } from '@/components/articles/useEnsureHeadingIds'
import { getCurrentReturnPath } from '@/lib/auth/safeReturnPath'
import {
  clearPendingHighlightSelection,
  readPendingHighlightSelection,
  writePendingHighlightSelection,
} from '@/lib/highlight/pendingHighlightSelection'
import {
  matchesHighlightPendingIntent,
  readPendingTipIntent,
} from '@/lib/tip/pendingTipIntent'

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
  const [signInPromptPosition, setSignInPromptPosition] = useState<{
    top: number
    left: number
  } | null>(null)
  const [signInSelection, setSignInSelection] = useState<{
    text: string
    from: number
    to: number
  } | null>(null)
  const editorRef = useRef<HTMLDivElement>(null)
  const isApplyingHighlightsRef = useRef(false)
  const selectionRestoredEditorRef = useRef<Editor | null>(null)
  const [resumeHighlightTip, setResumeHighlightTip] = useState<{
    amountCents?: number
    customAmount?: string
  } | null>(null)
  const pendingSelectionNeedsClearRef = useRef(false)
  // During a drag, onSelectionUpdate fires on every move; if we mount the
  // popover at 3 chars, HighlightPopover's FocusScope trap steals focus from
  // the article body and the native selection collapses. Defer popover to pointerup.
  const isDraggingRef = useRef(false)

  const { user, isAuthenticated } = useAuth()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const returnPath = getCurrentReturnPath(pathname, searchParams)
  const highlightsActive = showHighlights && isAuthenticated
  const signInPromptActive = showHighlights && !isAuthenticated

  useEnsureHeadingIds(tocHeadings, { rootSelector: '.highlightable-article' })
  const article = useArticleById(articleId)
  const canTipHighlight = Boolean(article?.author?.stellarAddress)

  const highlights = useArticleHighlightsQuery(articleId, highlightsActive)

  const highlightsRef = useRef(highlights)
  useEffect(() => {
    highlightsRef.current = highlights
  }, [highlights])

  const createHighlight = useMutation(api.highlights.createHighlight)

  const applySignedOutTextSelection = useCallback(
    (text: string, from: number, to: number, range: Range) => {
      const anchor = getRangeTopCenterAnchor(range)
      if (!anchor) return

      if (canTipHighlight) {
        setSelectedText({ text, from, to })
        setPopoverPosition(anchor)
        setSignInSelection(null)
      } else {
        setSignInSelection({ text, from, to })
        setSignInPromptPosition(anchor)
        setSelectedText(null)
        setPopoverPosition(null)
      }
    },
    [canTipHighlight]
  )

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
        ...(highlightsActive
          ? [
              HighlightExtension.configure({
                multicolor: true,
                highlights:
                  highlights?.map((h) => ({
                    id: h._id,
                    startOffset: h.startOffset,
                    endOffset: h.endOffset,
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

            if (signInPromptActive) {
              applySignedOutTextSelection(text, from, to, range)
            } else if (highlightsActive) {
              const rect = range.getBoundingClientRect()
              const containerRect = editorRef.current?.getBoundingClientRect()

              setSelectedText({ text, from, to })
              if (containerRect) {
                setPopoverPosition({
                  top: rect.top - containerRect.top - 60,
                  left: rect.left - containerRect.left + rect.width / 2,
                })
              }
              setSignInSelection(null)
              setSignInPromptPosition(null)
            }
          }
        } else {
          setSelectedText(null)
          setPopoverPosition(null)
          setSignInSelection(null)
          setSignInPromptPosition(null)
        }
      },
    },
    [
      showHighlights,
      highlightsActive,
      signInPromptActive,
      editable,
      articleId,
      applySignedOutTextSelection,
    ]
  )

  useEffect(() => {
    if (!showHighlights) {
      setSelectedText(null)
      setPopoverPosition(null)
      setHighlightTooltip(null)
      setSignInSelection(null)
      setSignInPromptPosition(null)
    }
  }, [showHighlights])

  useEffect(() => {
    if (!isAuthenticated || !highlightsActive || !editor) return

    const pending = readPendingHighlightSelection()
    if (
      !shouldKeepTryingHighlightSelectionResume(
        pending,
        String(articleId),
        selectionRestoredEditorRef.current,
        editor
      )
    ) {
      return
    }

    let cancelled = false

    const tryRestoreSelection = (): boolean => {
      if (cancelled || !pending) return true
      if (selectionRestoredEditorRef.current === editor) return true

      applyPendingHighlightToEditor(editor, pending)

      const anchor = readPendingHighlightPopoverAnchor(editor)
      if (!anchor) return false

      selectionRestoredEditorRef.current = editor
      pendingSelectionNeedsClearRef.current = true
      setSelectedText({
        text: pending.highlightText,
        from: pending.startOffset,
        to: pending.endOffset,
      })
      setPopoverPosition(anchor)
      setSignInSelection(null)
      setSignInPromptPosition(null)

      const tipIntent = readPendingTipIntent()
      if (matchesHighlightPendingIntent(tipIntent, articleId)) {
        setResumeHighlightTip({
          amountCents: tipIntent.amountCents,
          customAmount: tipIntent.customAmount,
        })
      }

      return true
    }

    if (tryRestoreSelection()) return

    const intervalId = window.setInterval(() => {
      if (tryRestoreSelection()) {
        window.clearInterval(intervalId)
      }
    }, 100)

    const timeoutId = window.setTimeout(() => {
      window.clearInterval(intervalId)
    }, 15_000)

    return () => {
      cancelled = true
      window.clearInterval(intervalId)
      window.clearTimeout(timeoutId)
    }
  }, [isAuthenticated, highlightsActive, articleId, editor])

  useEffect(() => {
    if (!pendingSelectionNeedsClearRef.current) return
    if (!popoverPosition || !selectedText) return

    // Clear storage only after we can observe the popover in the DOM.
    const raf1 = requestAnimationFrame(() => {
      const raf2 = requestAnimationFrame(() => {
        const popover = document.querySelector(
          '[data-testid="highlight-popover"]'
        )
        if (popover) {
          clearPendingHighlightSelection()
          pendingSelectionNeedsClearRef.current = false
        }
      })
      return () => cancelAnimationFrame(raf2)
    })
    return () => cancelAnimationFrame(raf1)
  }, [popoverPosition, selectedText])

  useEffect(() => {
    if (!editor || !highlights || !highlightsActive) return

    // Suppress popover during programmatic highlight application
    isApplyingHighlightsRef.current = true
    HighlightConverter.applyHighlightsToEditor(editor, highlights)
    // Clear flag after selection events from apply have fired
    requestAnimationFrame(() => {
      isApplyingHighlightsRef.current = false
    })
  }, [editor, highlights, highlightsActive])

  // Show overlay only after the user releases a drag-select.
  useEffect(() => {
    const container = editorRef.current
    if (!container || editable || !showHighlights) return

    const handlePointerDown = (e: MouseEvent | TouchEvent) => {
      handleArticleHighlightOverlayPointerDown(e.target, {
        closeCreatePopover: () => {
          isDraggingRef.current = true
          setSelectedText(null)
          setPopoverPosition(null)
          setSignInSelection(null)
          setSignInPromptPosition(null)
        },
        closeDetailsPanel: () => setHighlightTooltip(null),
        closeSignInPrompt: () => {
          setSignInSelection(null)
          setSignInPromptPosition(null)
        },
      })
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

        if (signInPromptActive) {
          applySignedOutTextSelection(text, from, to, range)
        } else if (highlightsActive) {
          setSelectedText({ text, from, to })
          setPopoverPosition(anchor)
          setSignInSelection(null)
          setSignInPromptPosition(null)
        }
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
  }, [
    editor,
    editable,
    showHighlights,
    highlightsActive,
    signInPromptActive,
    applySignedOutTextSelection,
  ])

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

  const handleSignInPromptClose = useCallback(() => {
    if (editor) {
      const { from, to } = editor.state.selection
      if (from !== to) {
        editor.chain().setTextSelection(from).run()
      }
    }
    setSignInSelection(null)
    setSignInPromptPosition(null)
    window.getSelection()?.removeAllRanges()
    editor?.commands.focus()
  }, [editor])

  const saveHighlightSelectionBeforeAuth = useCallback(() => {
    if (!signInSelection) return
    writePendingHighlightSelection({
      articleId: String(articleId),
      highlightText: signInSelection.text,
      startOffset: signInSelection.from,
      endOffset: signInSelection.to,
    })
  }, [articleId, signInSelection])

  return (
    <div
      className={cn('highlightable-article relative', className)}
      ref={editorRef}
    >
      <EditorContent editor={editor} />

      <AnimatePresence>
        {popoverPosition &&
          selectedText &&
          article &&
          (highlightsActive || (signInPromptActive && canTipHighlight)) && (
            <HighlightPopover
              position={popoverPosition}
              onCreateHighlight={handleCreateHighlight}
              onClose={handlePopoverClose}
              selectedText={selectedText.text}
              articleId={articleId}
              articleSlug={article.slug}
              authorName={
                article.author?.name || article.authorName || 'Author'
              }
              authorStellarAddress={article.author?.stellarAddress}
              startOffset={selectedText.from}
              endOffset={selectedText.to}
              resumeHighlightTip={resumeHighlightTip}
              onHighlightTipResumeOpened={() => {
                setResumeHighlightTip(null)
              }}
            />
          )}
      </AnimatePresence>

      <AnimatePresence>
        {signInPromptActive &&
          signInPromptPosition &&
          signInSelection &&
          !canTipHighlight && (
            <HighlightSignInPrompt
              position={signInPromptPosition}
              selectedText={signInSelection.text}
              returnPath={returnPath}
              onBeforeAuthNavigate={saveHighlightSelectionBeforeAuth}
              onClose={handleSignInPromptClose}
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
