'use client'

import {
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from 'react'
import { Editor } from '@tiptap/react'
import { formatDistanceToNow } from 'date-fns'
import {
  ArrowLeft,
  Undo2,
  Redo2,
  MoreHorizontal,
  Trash2,
  Clock,
  LetterText,
  Loader2,
  FileText,
  ImageIcon,
  AlignLeft,
  ChevronDown,
} from 'lucide-react'
import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import { useIsMobile } from '@/hooks/use-mobile'
import { cn } from '@/lib/utils'
import { AUTO_SAVE_GUIDANCE } from '@/lib/autosave'
import { truncateFeedbackMessage } from '@/lib/feedback/flow-feedback'
import { estimateReadingMinutes } from '@/lib/reading-time'
import { MIN_LISTING_EXCERPT_CHARS } from '@/convex/lib/articleListingReady'
import { Collapsible, CollapsibleContent } from '@/components/ui/collapsible'
import { Textarea } from '@/components/ui/textarea'
import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
} from '@/components/ui/drawer'
import {
  WRITER_NOTES_HELPER_TEXT,
  WriterNotesPanel,
} from '@/components/editor/WriterNotesPanel'

function draftStatusTitle(
  lastSavedAt: Date | null | undefined,
  isSaving: boolean,
  error: string | null
): string {
  if (error) {
    return `${error} · ${AUTO_SAVE_GUIDANCE}`
  }
  if (isSaving) {
    return AUTO_SAVE_GUIDANCE
  }
  if (lastSavedAt) {
    return `Saved at ${lastSavedAt.toLocaleString()} · ${AUTO_SAVE_GUIDANCE}`
  }
  return AUTO_SAVE_GUIDANCE
}

function useUndoRedoShortcuts() {
  const [isApple, setIsApple] = useState(false)

  useEffect(() => {
    const platform = navigator.platform?.toLowerCase() ?? ''
    const ua = navigator.userAgent?.toLowerCase() ?? ''
    setIsApple(
      platform.includes('mac') ||
        platform.includes('iphone') ||
        ua.includes('mac os')
    )
  }, [])

  return {
    undo: isApple ? '⌘Z' : 'Ctrl+Z',
    redo: isApple ? '⌘⇧Z' : 'Ctrl+Shift+Z / Ctrl+Y',
  }
}

interface EditorActionBarProps {
  editor: Editor | null
  onBack: () => void
  onSave: () => void
  onPreview?: () => void
  onPublish: () => void
  isSaving: boolean
  error: string | null
  isPublished: boolean
  isPublishing: boolean
  canPublish: boolean
  publishBlockReason?: string | null
  onBlockReasonClick?: () => void
  lastSavedAt?: Date | null
  onDelete?: () => void
  isDeleting?: boolean
  hasUnsavedChanges?: boolean
  notes?: string
  onNotesChange?: (value: string) => void
  onAddCoverImage?: () => void
  hasCoverImage?: boolean
  excerpt?: string
  onExcerptChange?: (value: string) => void
  excerptOpen?: boolean
  onExcerptOpenChange?: (open: boolean) => void
  excerptTextareaRef?: RefObject<HTMLTextAreaElement | null>
  moreMenuOpen?: boolean
  onMoreMenuOpenChange?: (open: boolean) => void
  excerptMaxChars?: number
}

const RELATIVE_TIME_INTERVAL_MS = 30_000
const DEFAULT_EXCERPT_MAX_CHARS = 500

const focusRing =
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background'

function MoreMenu({
  editor,
  onDelete,
  isDeleting = false,
  onAddCoverImage,
  hasCoverImage = false,
  excerpt = '',
  onExcerptChange,
  excerptOpen = false,
  onExcerptOpenChange,
  excerptTextareaRef,
  moreMenuOpen,
  onMoreMenuOpenChange,
  excerptMaxChars = DEFAULT_EXCERPT_MAX_CHARS,
  isActive = true,
}: {
  editor: Editor | null
  onDelete?: () => void
  isDeleting?: boolean
  onAddCoverImage?: () => void
  hasCoverImage?: boolean
  excerpt?: string
  onExcerptChange?: (value: string) => void
  excerptOpen?: boolean
  onExcerptOpenChange?: (open: boolean) => void
  excerptTextareaRef?: RefObject<HTMLTextAreaElement | null>
  moreMenuOpen?: boolean
  onMoreMenuOpenChange?: (open: boolean) => void
  excerptMaxChars?: number
  isActive?: boolean
}) {
  const canUndo = editor?.can().undo() ?? false
  const canRedo = editor?.can().redo() ?? false
  const shortcuts = useUndoRedoShortcuts()
  const [internalOpen, setInternalOpen] = useState(false)
  const menuOpen = isActive && (moreMenuOpen ?? internalOpen)
  const excerptLabel = excerpt.trim() ? 'Edit excerpt' : 'Add excerpt'

  const handleOpenChange = (open: boolean) => {
    if (!isActive) return
    if (onMoreMenuOpenChange) {
      onMoreMenuOpenChange(open)
    } else {
      setInternalOpen(open)
    }
    if (!open) onExcerptOpenChange?.(false)
  }

  return (
    <DropdownMenu.Root open={menuOpen} onOpenChange={handleOpenChange}>
      <DropdownMenu.Trigger asChild>
        <button
          type="button"
          aria-label="More options"
          aria-hidden={!isActive}
          disabled={!isActive}
          tabIndex={isActive ? undefined : -1}
          className={`p-2 rounded-full border border-border text-muted-foreground hover:bg-muted hover:border-border transition-colors shrink-0 ${focusRing}`}
          title="More options"
        >
          <MoreHorizontal className="h-4 w-4" />
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          className={cn(
            'bg-card rounded-lg shadow-lg border border-border py-1 z-50',
            excerptOpen ? 'min-w-[280px]' : 'min-w-[180px]'
          )}
          sideOffset={4}
          align="end"
        >
          <DropdownMenu.Item
            disabled={!canUndo}
            onSelect={(e) => {
              e.preventDefault()
              editor?.chain().focus().undo().run()
            }}
            className={cn(
              'px-4 py-2.5 text-sm cursor-pointer outline-none flex items-center gap-2',
              canUndo
                ? 'text-foreground hover:bg-muted focus:bg-muted'
                : 'opacity-40 cursor-not-allowed'
            )}
          >
            <Undo2 className="w-4 h-4 shrink-0" />
            <span>Undo</span>
            <span className="ml-auto text-xs text-muted-foreground">
              {shortcuts.undo}
            </span>
          </DropdownMenu.Item>
          <DropdownMenu.Item
            disabled={!canRedo}
            onSelect={(e) => {
              e.preventDefault()
              editor?.chain().focus().redo().run()
            }}
            className={cn(
              'px-4 py-2.5 text-sm cursor-pointer outline-none flex items-center gap-2',
              canRedo
                ? 'text-foreground hover:bg-muted focus:bg-muted'
                : 'opacity-40 cursor-not-allowed'
            )}
          >
            <Redo2 className="w-4 h-4 shrink-0" />
            <span>Redo</span>
            <span className="ml-auto text-xs text-muted-foreground">
              {shortcuts.redo}
            </span>
          </DropdownMenu.Item>
          {onAddCoverImage && !hasCoverImage ? (
            <>
              <DropdownMenu.Separator className="h-px bg-border my-1" />
              <DropdownMenu.Item
                onSelect={() => {
                  onAddCoverImage()
                }}
                className="px-4 py-2.5 text-sm text-foreground hover:bg-muted focus:bg-muted cursor-pointer outline-none flex items-center gap-2"
              >
                <ImageIcon className="w-4 h-4 shrink-0" />
                <span>Add cover image</span>
              </DropdownMenu.Item>
            </>
          ) : null}
          {onExcerptChange && onExcerptOpenChange ? (
            <>
              <DropdownMenu.Separator className="h-px bg-border my-1" />
              <Collapsible
                open={excerptOpen}
                onOpenChange={onExcerptOpenChange}
              >
                <DropdownMenu.Item
                  className="px-4 py-2.5 text-sm text-foreground outline-none flex cursor-pointer items-center justify-between gap-2 hover:bg-muted focus:bg-muted data-[highlighted]:bg-muted"
                  onSelect={(event) => {
                    event.preventDefault()
                    const nextOpen = !excerptOpen
                    onExcerptOpenChange(nextOpen)
                    if (nextOpen) {
                      window.setTimeout(
                        () => excerptTextareaRef?.current?.focus(),
                        0
                      )
                    }
                  }}
                >
                  <span className="flex min-w-0 items-center gap-2">
                    <AlignLeft className="w-4 h-4 shrink-0" />
                    <span>{excerptLabel}</span>
                  </span>
                  <ChevronDown
                    className={cn(
                      'h-3.5 w-3.5 shrink-0 transition-transform',
                      excerptOpen && 'rotate-180'
                    )}
                  />
                </DropdownMenu.Item>
                <CollapsibleContent>
                  <div
                    id="field-excerpt"
                    className="space-y-2 border-t border-border px-3 pb-3 pt-2"
                    onPointerDown={(event) => event.stopPropagation()}
                  >
                    <p className="text-[11px] leading-snug text-muted-foreground">
                      Required for publishing. Shown on article cards and in the
                      publish preview (at least {MIN_LISTING_EXCERPT_CHARS}{' '}
                      characters).
                    </p>
                    <Textarea
                      ref={excerptTextareaRef}
                      id="article-excerpt"
                      value={excerpt}
                      onChange={(event) => onExcerptChange(event.target.value)}
                      placeholder="Brief description of your article"
                      rows={3}
                      maxLength={excerptMaxChars}
                      className="resize-none text-sm"
                    />
                    <p className="text-[11px] tabular-nums text-muted-foreground">
                      {Math.min(excerpt.length, excerptMaxChars)}/
                      {excerptMaxChars}
                    </p>
                  </div>
                </CollapsibleContent>
              </Collapsible>
            </>
          ) : null}
          <DropdownMenu.Separator className="h-px bg-border my-1" />
          <DropdownMenu.Item
            className="px-4 py-2.5 text-sm text-muted-foreground outline-none flex items-center gap-2"
            onSelect={(e) => e.preventDefault()}
          >
            <LetterText className="w-4 h-4 shrink-0" />
            {editor?.getText().split(/\s+/).filter(Boolean).length ?? 0} words
          </DropdownMenu.Item>
          <DropdownMenu.Item
            className="px-4 py-2.5 text-sm text-muted-foreground outline-none flex items-center gap-2"
            onSelect={(e) => e.preventDefault()}
          >
            <Clock className="w-4 h-4 shrink-0" />~
            {estimateReadingMinutes(editor?.getText() ?? '')} min read
          </DropdownMenu.Item>
          {onDelete && (
            <>
              <DropdownMenu.Separator className="h-px bg-border my-1" />
              <DropdownMenu.Item
                disabled={isDeleting}
                onSelect={(e) => {
                  if (isDeleting) {
                    e.preventDefault()
                    return
                  }
                  onDelete?.()
                }}
                className="px-4 py-2.5 text-sm text-destructive hover:bg-destructive/10 focus:bg-destructive/10 cursor-pointer outline-none flex items-center gap-2 disabled:opacity-50 disabled:pointer-events-none"
              >
                {isDeleting ? (
                  <>
                    <Loader2 className="w-4 h-4 shrink-0 animate-spin" />
                    Deleting...
                  </>
                ) : (
                  <>
                    <Trash2 className="w-4 h-4 shrink-0" />
                    Delete draft
                  </>
                )}
              </DropdownMenu.Item>
            </>
          )}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  )
}

function NotesControl({
  notes,
  onNotesChange,
}: {
  notes: string
  onNotesChange: (value: string) => void
}) {
  const isMobile = useIsMobile()
  const [showNotes, setShowNotes] = useState(false)
  const notesTriggerRef = useRef<HTMLButtonElement>(null)
  const notesTextareaRef = useRef<HTMLTextAreaElement>(null)

  const triggerButton = (
    <button
      ref={notesTriggerRef}
      type="button"
      aria-label="Notes"
      aria-expanded={showNotes}
      title="Notes"
      onClick={() => {
        if (isMobile) {
          setShowNotes(true)
        } else {
          setShowNotes((open) => !open)
        }
      }}
      className={cn(
        'flex items-center gap-1.5 rounded px-2.5 py-1.5 text-sm font-medium transition-colors hover:bg-muted shrink-0',
        focusRing,
        showNotes ? 'bg-muted text-primary' : 'text-muted-foreground'
      )}
    >
      <FileText className="h-4 w-4 shrink-0" />
      <span className="hidden sm:inline">Notes</span>
    </button>
  )

  if (isMobile) {
    return (
      <Drawer open={showNotes} onOpenChange={setShowNotes}>
        {triggerButton}
        <DrawerContent
          className="max-h-[min(70dvh,32rem)] gap-0 overflow-y-auto px-0 pb-6"
          onOpenAutoFocus={(e) => {
            e.preventDefault()
            notesTextareaRef.current?.focus()
          }}
          onCloseAutoFocus={(e) => {
            e.preventDefault()
            notesTriggerRef.current?.focus()
          }}
        >
          <DrawerHeader className="space-y-0 px-4 pb-2 text-left">
            <div className="flex items-start justify-between gap-3 pr-8">
              <div className="min-w-0 space-y-1">
                <DrawerTitle className="text-base">Personal Notes</DrawerTitle>
                <DrawerDescription className="text-left text-xs leading-snug">
                  {WRITER_NOTES_HELPER_TEXT}
                </DrawerDescription>
              </div>
              <DrawerClose asChild>
                <button
                  type="button"
                  className={cn(
                    'shrink-0 rounded-md px-3 py-1.5 text-sm font-medium text-primary hover:bg-muted',
                    focusRing
                  )}
                >
                  Done
                </button>
              </DrawerClose>
            </div>
          </DrawerHeader>
          <WriterNotesPanel
            ref={notesTextareaRef}
            notes={notes}
            onNotesChange={onNotesChange}
            showHeader={false}
            textareaClassName="min-h-[8rem] rounded-none border-0 bg-background"
          />
        </DrawerContent>
      </Drawer>
    )
  }

  return (
    <div className="relative">
      {triggerButton}
      {showNotes && (
        <div
          className="absolute top-full right-0 z-50 mt-1 w-72 max-w-[min(18rem,calc(100vw-2rem))] overflow-hidden rounded-lg border border-border bg-popover shadow-lg"
          role="dialog"
          aria-label="Personal notes"
        >
          <WriterNotesPanel
            ref={notesTextareaRef}
            notes={notes}
            onNotesChange={onNotesChange}
            textareaClassName="rounded-b-lg"
          />
        </div>
      )}
    </div>
  )
}

export function EditorActionBar({
  editor,
  onBack,
  onSave: _onSave,
  onPreview,
  onPublish,
  isSaving,
  error,
  isPublished,
  isPublishing,
  canPublish,
  publishBlockReason = null,
  onBlockReasonClick,
  lastSavedAt,
  onDelete,
  isDeleting = false,
  hasUnsavedChanges = false,
  notes = '',
  onNotesChange,
  onAddCoverImage,
  hasCoverImage = false,
  excerpt,
  onExcerptChange,
  excerptOpen,
  onExcerptOpenChange,
  excerptTextareaRef,
  moreMenuOpen,
  onMoreMenuOpenChange,
  excerptMaxChars,
}: EditorActionBarProps) {
  const publishBlockReasonId = useId()
  const [relativeTick, setRelativeTick] = useState(0)
  const isMobile = useIsMobile()

  const showRelativeSaved =
    !isSaving && !error && !hasUnsavedChanges && lastSavedAt != null

  useEffect(() => {
    if (!showRelativeSaved) return
    const id = setInterval(() => {
      setRelativeTick((n) => n + 1)
    }, RELATIVE_TIME_INTERVAL_MS)
    return () => clearInterval(id)
  }, [showRelativeSaved, lastSavedAt])

  let statusText: ReactNode
  let statusClassName = 'text-muted-foreground'

  if (isSaving) {
    statusText = (
      <>
        <Loader2
          className="h-3.5 w-3.5 shrink-0 animate-spin opacity-70"
          aria-hidden
        />
        Saving...
      </>
    )
  } else if (error) {
    statusText = (
      <>
        <span className="shrink-0">Couldn&apos;t save:</span>
        <span className="truncate">{truncateFeedbackMessage(error, 80)}</span>
      </>
    )
    statusClassName = 'text-destructive'
  } else if (hasUnsavedChanges) {
    statusText = 'Unsaved'
    statusClassName = 'text-muted-foreground/70'
  } else if (lastSavedAt) {
    statusText = `Saved ${formatDistanceToNow(lastSavedAt, { addSuffix: true })}`
  } else {
    statusText = null
  }

  const publishControl = isPublished ? (
    <span className="px-4 py-2 text-sm font-medium bg-success text-success-foreground rounded-full shrink-0">
      Published
    </span>
  ) : (
    <button
      type="button"
      onClick={onPublish}
      disabled={isPublishing || !canPublish}
      aria-describedby={publishBlockReason ? publishBlockReasonId : undefined}
      className="px-5 py-2 text-sm font-medium bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed rounded-full transition-colors shrink-0"
      title={
        publishBlockReason
          ? publishBlockReason
          : canPublish
            ? 'Publish article'
            : 'Add content before publishing'
      }
    >
      {isPublishing ? 'Publishing...' : 'Publish'}
    </button>
  )

  const draftStatus = statusText ? (
    <span
      title={draftStatusTitle(lastSavedAt, isSaving, error)}
      className={`flex items-center gap-1.5 text-xs truncate ${statusClassName} ${isSaving ? 'gap-2' : 'gap-1.5'}`}
      aria-live="polite"
      data-relative-tick={relativeTick}
    >
      {statusText}
    </span>
  ) : null

  return (
    <div className="w-full min-w-0 bg-card border-b border-border shadow-sm">
      {/* sr-only live region for assistive technology */}
      <span
        role="status"
        aria-live="polite"
        className="sr-only"
        title={draftStatusTitle(lastSavedAt, isSaving, error)}
      >
        {statusText}
      </span>

      {/* sr-only publish block reason for aria-describedby */}
      {publishBlockReason && !isPublished && (
        <span id={publishBlockReasonId} className="sr-only">
          {publishBlockReason}
        </span>
      )}

      {/* Mobile layout */}
      <div className="flex flex-col gap-1.5 px-4 py-2.5 sm:hidden">
        <div className="flex min-w-0 items-center justify-between gap-2">
          <button
            type="button"
            onClick={onBack}
            className="flex shrink-0 items-center gap-2 text-muted-foreground hover:text-foreground font-medium transition-colors"
          >
            <ArrowLeft className="h-4 w-4" />
            Back
          </button>
          <div className="flex min-w-0 items-center justify-end gap-1.5">
            {onNotesChange && (
              <NotesControl notes={notes} onNotesChange={onNotesChange} />
            )}
            {publishControl}
            <MoreMenu
              editor={editor}
              onDelete={onDelete}
              isDeleting={isDeleting}
              onAddCoverImage={onAddCoverImage}
              hasCoverImage={hasCoverImage}
              excerpt={excerpt}
              onExcerptChange={onExcerptChange}
              excerptOpen={excerptOpen}
              onExcerptOpenChange={onExcerptOpenChange}
              excerptTextareaRef={excerptTextareaRef}
              moreMenuOpen={moreMenuOpen}
              onMoreMenuOpenChange={onMoreMenuOpenChange}
              excerptMaxChars={excerptMaxChars}
              isActive={isMobile}
            />
          </div>
        </div>
        {draftStatus && (
          <div className="flex min-w-0 items-center gap-2 overflow-x-auto overflow-y-hidden pb-0.5">
            {draftStatus}
            {onPreview && (
              <>
                <div className="mx-1 h-4 w-px shrink-0 bg-border" />
                <button
                  type="button"
                  onClick={onPreview}
                  className="shrink-0 rounded px-3 py-1 text-xs text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
                >
                  Preview
                </button>
              </>
            )}
          </div>
        )}
      </div>

      {/* Desktop layout */}
      <div className="hidden items-center justify-between gap-4 px-4 py-2.5 sm:flex">
        <button
          type="button"
          onClick={onBack}
          className="flex items-center gap-2 text-muted-foreground hover:text-foreground font-medium transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
          Back
        </button>

        <div className="flex min-w-0 flex-1 items-center justify-end gap-2">
          {draftStatus && (
            <>
              {draftStatus}
              <div className="mx-1 h-5 w-px shrink-0 bg-border" />
            </>
          )}

          {onPreview && (
            <>
              <button
                type="button"
                onClick={onPreview}
                className="rounded px-3 py-1.5 text-sm text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
                title="Preview"
              >
                Preview
              </button>
              <div className="mx-1 h-5 w-px shrink-0 bg-border" />
            </>
          )}

          {onNotesChange && (
            <NotesControl notes={notes} onNotesChange={onNotesChange} />
          )}

          {publishControl}

          <MoreMenu
            editor={editor}
            onDelete={onDelete}
            isDeleting={isDeleting}
            onAddCoverImage={onAddCoverImage}
            hasCoverImage={hasCoverImage}
            excerpt={excerpt}
            onExcerptChange={onExcerptChange}
            excerptOpen={excerptOpen}
            onExcerptOpenChange={onExcerptOpenChange}
            excerptTextareaRef={excerptTextareaRef}
            moreMenuOpen={moreMenuOpen}
            onMoreMenuOpenChange={onMoreMenuOpenChange}
            excerptMaxChars={excerptMaxChars}
            isActive={!isMobile}
          />
        </div>
      </div>

      {publishBlockReason &&
        !isPublished &&
        (onBlockReasonClick ? (
          <button
            type="button"
            onClick={onBlockReasonClick}
            className={cn(
              'w-full border-t border-border bg-muted/50 px-4 py-2 text-left text-xs text-muted-foreground',
              'cursor-pointer hover:bg-muted',
              focusRing
            )}
          >
            {publishBlockReason}
          </button>
        ) : (
          <div
            role="status"
            className="border-t border-border bg-muted/50 px-4 py-2 text-xs text-muted-foreground"
          >
            {publishBlockReason}
          </div>
        ))}

      {error && (
        <p
          role="alert"
          className="border-t border-border bg-destructive/10 px-4 py-2 text-xs text-destructive break-words"
        >
          {error}
        </p>
      )}
    </div>
  )
}
