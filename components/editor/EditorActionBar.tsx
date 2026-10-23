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
import { ArrowLeft, Loader2 } from 'lucide-react'
import { useIsMobile } from '@/hooks/use-mobile'
import { cn } from '@/lib/utils'
import { AUTO_SAVE_GUIDANCE } from '@/lib/autosave'
import { truncateFeedbackMessage } from '@/lib/feedback/flow-feedback'
import { MoreMenu } from '@/components/editor/MoreMenu'
import { focusRing } from '@/components/editor/EditorActionBarShared'

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
  notesOpen?: boolean
  onNotesOpenChange?: (open: boolean) => void
}

const RELATIVE_TIME_INTERVAL_MS = 30_000

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
  notesOpen: notesOpenProp,
  onNotesOpenChange: onNotesOpenChangeProp,
}: EditorActionBarProps) {
  const publishBlockReasonId = useId()
  const [relativeTick, setRelativeTick] = useState(0)
  const isMobile = useIsMobile()
  const [internalNotesOpen, setInternalNotesOpen] = useState(false)
  const notesTextareaRef = useRef<HTMLTextAreaElement>(null)
  const notesOpen = notesOpenProp ?? internalNotesOpen
  const onNotesOpenChange = onNotesOpenChangeProp ?? setInternalNotesOpen

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
              notes={notes}
              onNotesChange={onNotesChange}
              notesOpen={notesOpen}
              onNotesOpenChange={onNotesOpenChange}
              notesTextareaRef={notesTextareaRef}
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
            notes={notes}
            onNotesChange={onNotesChange}
            notesOpen={notesOpen}
            onNotesOpenChange={onNotesOpenChange}
            notesTextareaRef={notesTextareaRef}
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
