'use client'

import { focusLibraryHighlight } from '@/lib/library/focusHighlight'

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
import { createYoutubeExtension } from '@/lib/tiptap/youtubeExtension'
import { HighlightConverter } from '@/lib/highlights/HighlightConverter'
import { TextSelection } from '@tiptap/pm/state'
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
import { PUBLISHED_PROSE_CLASS } from '@/lib/constants'
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
    viewerId?: string
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
  const isKeyboardSelectingRef = useRef(false)

  const { user, isAuthenticated } = useAuth()
  const currentUserIdRef = useRef(user?._id)
  useEffect(() => {
    currentUserIdRef.current = user?._id
  }, [user?._id])
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const returnPath = getCurrentReturnPath(pathname, searchParams)
  const libraryHighlight = searchParams.get('highlight')
  const focusedLibraryHighlight = useRef<string | null>(null)
  const highlightsActive = showHighlights && isAuthenticated
  const signInPromptActive = showHighlights && !isAuthenticated

  useEnsureHeadingIds(tocHeadings, { rootSelector: '.highlightable-article' })
  const article = useArticleById(articleId)
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

      setSelectedText({ text, from, to })
      setPopoverPosition(anchor)
      setSignInSelection(null)
      setSignInPromptPosition(null)
    },
    []
  )

  const presentSelection = useCallback(
    (state: Editor['state']) => {
      if (editable || isApplyingHighlightsRef.current) return
      if (!showHighlights) return
      // Keyboard selection (shift+arrow, ctrl+a) still runs this path.
      if (isDraggingRef.current || isKeyboardSelectingRef.current) return

      const { selection } = state
      const { from, to } = selection
      const text = state.doc.textBetween(from, to, ' ')

      if (text.trim().length >= 3) {
        const domSelection = window.getSelection()
        if (domSelection && domSelection.rangeCount > 0) {
          const range = domSelection.getRangeAt(0)

          if (signInPromptActive) {
            applySignedOutTextSelection(text, from, to, range)
          } else if (highlightsActive) {
            const anchor = getRangeTopCenterAnchor(range)
            if (!anchor) return
            setSelectedText({ text, from, to })
            setPopoverPosition(anchor)
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
    [
      editable,
      showHighlights,
      signInPromptActive,
      highlightsActive,
      applySignedOutTextSelection,
    ]
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
        createYoutubeExtension(),
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
                        viewerId: currentUserIdRef.current,
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
        handleDOMEvents: {
          keydown(view, event) {
            if (
              editable ||
              !showHighlights ||
              !event.shiftKey ||
              ![
                'ArrowLeft',
                'ArrowRight',
                'ArrowUp',
                'ArrowDown',
                'Home',
                'End',
              ].includes(event.key)
            )
              return false
            const selection = window.getSelection()
            if (!selection?.modify) return false
            isKeyboardSelectingRef.current = true
            if (
              !selection.anchorNode ||
              !view.dom.contains(selection.anchorNode)
            ) {
              const range = document.createRange()
              const start = view.domAtPos(1)
              range.setStart(start.node, start.offset)
              range.collapse(true)
              selection.removeAllRanges()
              selection.addRange(range)
            }
            const forward = ['ArrowRight', 'ArrowDown', 'End'].includes(
              event.key
            )
            const vertical = ['ArrowUp', 'ArrowDown'].includes(event.key)
            const boundary = ['Home', 'End'].includes(event.key)
            const largeStep = event.ctrlKey || event.metaKey
            const granularity = boundary
              ? largeStep
                ? 'documentboundary'
                : 'lineboundary'
              : vertical
                ? largeStep
                  ? 'paragraph'
                  : 'line'
                : largeStep || event.altKey
                  ? 'word'
                  : 'character'
            selection.modify(
              'extend',
              forward ? 'forward' : 'backward',
              granularity
            )
            if (
              selection.anchorNode &&
              selection.focusNode &&
              view.dom.contains(selection.anchorNode) &&
              view.dom.contains(selection.focusNode)
            ) {
              const anchor = view.posAtDOM(
                selection.anchorNode,
                selection.anchorOffset
              )
              const head = view.posAtDOM(
                selection.focusNode,
                selection.focusOffset
              )
              view.dispatch(
                view.state.tr.setSelection(
                  TextSelection.create(view.state.doc, anchor, head)
                )
              )
            }
            event.preventDefault()
            return true
          },
          keyup(view, event) {
            if (event.key === 'Shift' && isKeyboardSelectingRef.current) {
              isKeyboardSelectingRef.current = false
              presentSelection(view.state)
            }
            return false
          },
          blur() {
            isKeyboardSelectingRef.current = false
            return false
          },
        },
        attributes: {
          class: `${PUBLISHED_PROSE_CLASS} prose-stone`,
          tabindex: '0',
        },
      },
      onSelectionUpdate: ({ editor }) => presentSelection(editor.state),
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
      if (
        libraryHighlight &&
        focusedLibraryHighlight.current !== libraryHighlight &&
        editorRef.current &&
        focusLibraryHighlight(
          editorRef.current,
          libraryHighlight,
          matchMedia('(prefers-reduced-motion: reduce)').matches,
          { editor, highlights }
        )
      )
        focusedLibraryHighlight.current = libraryHighlight
    })
  }, [editor, highlights, highlightsActive, libraryHighlight])

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
    async (
      color: string,
      note?: string,
      isPublic: boolean = true,
      keepOpen = false
    ) => {
      if (!selectedText || !editor) return false

      try {
        // Live highlight updates can move the editor selection while this panel
        // is open. Save the passage that opened it, using the same offset mapping.
        const highlightData = HighlightConverter.selectionToHighlightData(
          editor,
          TextSelection.create(
            editor.state.doc,
            selectedText.from,
            selectedText.to
          ),
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

          if (!keepOpen) {
            setSelectedText(null)
            setPopoverPosition(null)
            window.getSelection()?.removeAllRanges()
          }
          // Highlights re-apply when the Convex query refetches.
          return true
        }
        return false
      } catch (error) {
        console.error('Error creating highlight:', error)
        toast.error('Failed to create highlight', {
          description:
            error instanceof Error
              ? error.message
              : 'Please try again or refresh the page.',
        })
        return false
      }
    },
    [selectedText, editor, articleId, createHighlight]
  )

  const restoreArticleFocus = useCallback(() => {
    // An outside click may already have focused another reader control.
    if (document.activeElement && document.activeElement !== document.body)
      return
    // Resolve the current DOM: a live query can recreate the read-only editor.
    editorRef.current
      ?.querySelector<HTMLElement>('.tiptap')
      ?.focus({ preventScroll: true })
  }, [])

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
  }, [editor])

  const handleTooltipClose = useCallback(() => {
    setHighlightTooltip(null)
  }, [])

  const handleHighlightDeleted = useCallback(
    (highlightId: Id<'highlights'>) => {
      const remainingHighlights = (highlightsRef.current ?? []).filter(
        (highlight) => highlight._id !== highlightId
      )

      highlightsRef.current = remainingHighlights
      setHighlightTooltip((current) =>
        current?.highlight._id === highlightId ? null : current
      )

      if (editor && highlightsActive) {
        HighlightConverter.applyHighlightsToEditor(editor, remainingHighlights)
      }
    },
    [editor, highlightsActive]
  )

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
  }, [editor])

  const saveHighlightSelectionBeforeAuth = useCallback(() => {
    if (!signInSelection) return
    return writePendingHighlightSelection({
      articleId: String(articleId),
      highlightText: signInSelection.text,
      startOffset: signInSelection.from,
      endOffset: signInSelection.to,
    })
  }, [articleId, signInSelection])

  const activeTooltipHighlight =
    highlightTooltip &&
    highlights?.find((h) => h._id === highlightTooltip.highlight._id)

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
          editor &&
          (highlightsActive || signInPromptActive) && (
            <HighlightPopover
              position={popoverPosition}
              onCreateHighlight={handleCreateHighlight}
              onSignInToSave={() => {
                setSignInSelection(selectedText)
                setSignInPromptPosition(popoverPosition)
                setSelectedText(null)
                setPopoverPosition(null)
              }}
              onClose={handlePopoverClose}
              onRestoreFocus={restoreArticleFocus}
              selectedText={selectedText.text}
              articleId={articleId}
              articleSlug={article.slug}
              authorName={
                article.author?.name || article.authorName || 'Author'
              }
              authorStellarAddress={article.author?.stellarAddress}
              startOffset={HighlightConverter.getTextOffset(
                editor.state.doc,
                selectedText.from
              )}
              endOffset={HighlightConverter.getTextOffset(
                editor.state.doc,
                selectedText.to
              )}
              startContainerPath={`text.${selectedText.from}`}
              endContainerPath={`text.${selectedText.to}`}
              selectionStartPosition={selectedText.from}
              selectionEndPosition={selectedText.to}
              resumeHighlightTip={resumeHighlightTip}
              onHighlightTipResumeOpened={() => {
                setResumeHighlightTip(null)
              }}
            />
          )}
      </AnimatePresence>

      <AnimatePresence>
        {signInPromptActive && signInPromptPosition && signInSelection && (
          <HighlightSignInPrompt
            position={signInPromptPosition}
            selectedText={signInSelection.text}
            returnPath={returnPath}
            onBeforeAuthNavigate={saveHighlightSelectionBeforeAuth}
            onClose={handleSignInPromptClose}
            onRestoreFocus={restoreArticleFocus}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {highlightTooltip &&
          article &&
          highlightsActive &&
          activeTooltipHighlight &&
          highlightTooltip.viewerId === user?._id && (
            <HighlightDetailsPanel
              key={`${user?._id ?? 'guest'}:${highlightTooltip.highlight._id}`}
              highlight={activeTooltipHighlight}
              position={highlightTooltip.position}
              onClose={handleTooltipClose}
              onRestoreFocus={restoreArticleFocus}
              onDeleted={handleHighlightDeleted}
              currentUserId={user?._id as Id<'users'> | undefined}
              articleId={articleId}
              articleSlug={article.slug}
              authorName={
                article.author?.name || article.authorName || 'Author'
              }
              authorStellarAddress={article.author?.stellarAddress}
            />
          )}
      </AnimatePresence>
    </div>
  )
}
