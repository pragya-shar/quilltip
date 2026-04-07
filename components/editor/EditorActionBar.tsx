'use client'

import { useEffect, useState, type ReactNode } from 'react'
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
} from 'lucide-react'
import * as DropdownMenu from '@radix-ui/react-dropdown-menu'

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
  lastSavedAt?: Date | null
  onDelete?: () => void
  hasUnsavedChanges?: boolean
}

const RELATIVE_TIME_INTERVAL_MS = 30_000

function MoreMenu({
  editor,
  onDelete,
}: {
  editor: Editor | null
  onDelete?: () => void
}) {
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button
          type="button"
          className="p-2 rounded-full border border-border text-muted-foreground hover:bg-muted hover:border-border transition-colors shrink-0"
          title="More options"
        >
          <MoreHorizontal className="h-4 w-4" />
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          className="bg-card rounded-lg shadow-lg border border-border py-1 z-50 min-w-[180px]"
          sideOffset={4}
          align="end"
        >
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
            {Math.max(
              1,
              Math.ceil(
                (editor?.getText().split(/\s+/).filter(Boolean).length ?? 0) /
                  200
              )
            )}{' '}
            min read
          </DropdownMenu.Item>
          {onDelete && (
            <>
              <DropdownMenu.Separator className="h-px bg-border my-1" />
              <DropdownMenu.Item
                onSelect={onDelete}
                className="px-4 py-2.5 text-sm text-red-600 hover:bg-red-50 cursor-pointer outline-none flex items-center gap-2"
              >
                <Trash2 className="w-4 h-4 shrink-0" />
                Delete draft
              </DropdownMenu.Item>
            </>
          )}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  )
}

export function EditorActionBar({
  editor,
  onBack,
  onSave,
  onPreview,
  onPublish,
  isSaving,
  error,
  isPublished,
  isPublishing,
  canPublish,
  lastSavedAt,
  onDelete,
  hasUnsavedChanges = false,
}: EditorActionBarProps) {
  const [relativeTick, setRelativeTick] = useState(0)

  const canUndo = editor?.can().undo ?? false
  const canRedo = editor?.can().redo ?? false

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
    statusText = "Couldn't save"
    statusClassName = 'text-destructive'
  } else if (hasUnsavedChanges) {
    statusText = 'Unsaved changes'
    statusClassName = 'text-red-500'
  } else if (lastSavedAt) {
    statusText = `Saved ${formatDistanceToNow(lastSavedAt, { addSuffix: true })}`
  } else {
    statusText = 'Not saved yet'
    statusClassName = 'text-muted-foreground opacity-70'
  }

  const saveButton = (
    <button
      type="button"
      onClick={onSave}
      disabled={isSaving}
      aria-busy={isSaving}
      className="px-3 py-1.5 text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-muted disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-transparent rounded transition-colors shrink-0"
      title={isSaving ? 'Saving draft...' : 'Save draft'}
    >
      Save
    </button>
  )

  const publishControl = isPublished ? (
    <span className="px-4 py-2 text-sm font-medium text-green-700 bg-green-50 rounded-full shrink-0">
      Published
    </span>
  ) : (
    <button
      type="button"
      onClick={onPublish}
      disabled={isPublishing || !canPublish}
      className="px-5 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed rounded-full transition-colors shrink-0"
      title="Publish article"
    >
      {isPublishing ? 'Publishing...' : 'Publish'}
    </button>
  )

  const draftStatus = (
    <span className="flex min-w-0 items-center gap-2 text-sm shrink-0">
      <span
        className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full font-medium ${hasUnsavedChanges ? 'bg-red-50 text-red-700' : 'bg-yellow-100 text-amber-800'}`}
      >
        <span
          className={`w-1.5 h-1.5 rounded-full shrink-0 ${hasUnsavedChanges ? 'bg-red-500' : 'bg-amber-500'}`}
          aria-hidden
        />
        Draft
      </span>
      <span
        role="status"
        aria-live="polite"
        data-relative-tick={relativeTick}
        title={
          lastSavedAt && !isSaving && !error
            ? lastSavedAt.toLocaleString()
            : error || undefined
        }
        className={`flex items-center text-xs sm:text-sm truncate ${statusClassName} ${isSaving ? 'gap-2' : 'gap-1.5'}`}
      >
        {statusText}
      </span>
    </span>
  )

  const undoRedo = (
    <>
      <button
        type="button"
        onClick={() => editor?.chain().focus().undo().run()}
        disabled={!canUndo}
        className="p-2 rounded-md text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent transition-colors shrink-0"
        title="Undo"
      >
        <Undo2 className="h-4 w-4" />
      </button>
      <button
        type="button"
        onClick={() => editor?.chain().focus().redo().run()}
        disabled={!canRedo}
        className="p-2 rounded-md text-muted-foreground opacity-70 hover:bg-muted hover:opacity-100 disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:bg-transparent transition-colors shrink-0"
        title="Redo"
      >
        <Redo2 className="h-4 w-4" />
      </button>
    </>
  )

  return (
    <div className="w-full min-w-0 bg-card border-b border-border shadow-sm">
      {/* Mobile: primary row (Back + Save + Publish + More), secondary scroll row */}
      <div className="flex flex-col gap-2 px-4 py-3 sm:hidden">
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
            {saveButton}
            {publishControl}
            <MoreMenu editor={editor} onDelete={onDelete} />
          </div>
        </div>
        <div className="flex min-w-0 items-center gap-2 overflow-x-auto overflow-y-hidden overscroll-x-contain [-webkit-overflow-scrolling:touch] pb-0.5 [scrollbar-width:thin]">
          {undoRedo}
          <div className="mx-1 h-6 w-px shrink-0 bg-border" />
          {draftStatus}
          {onPreview && (
            <>
              <div className="mx-1 h-6 w-px shrink-0 bg-border" />
              <button
                type="button"
                onClick={onPreview}
                className="shrink-0 rounded px-3 py-1.5 text-sm text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
                title="Preview"
              >
                Preview
              </button>
            </>
          )}
        </div>
      </div>

      {/* Desktop: single row (unchanged structure) */}
      <div className="hidden items-center justify-between gap-4 px-4 py-3 sm:flex">
        <button
          type="button"
          onClick={onBack}
          className="flex items-center gap-2 text-muted-foreground hover:text-foreground font-medium transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
          Back
        </button>

        <div className="flex min-w-0 flex-1 items-center justify-end gap-2">
          {undoRedo}

          <div className="mx-1 h-6 w-px bg-border" />

          {draftStatus}

          <div className="mx-1 h-6 w-px bg-border" />

          {saveButton}

          {onPreview && (
            <>
              <div className="mx-1 h-6 w-px bg-border" />
              <button
                type="button"
                onClick={onPreview}
                className="rounded px-3 py-1.5 text-sm text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
                title="Preview"
              >
                Preview
              </button>
            </>
          )}

          <div className="mx-1 h-6 w-px bg-border" />

          {publishControl}

          <MoreMenu editor={editor} onDelete={onDelete} />
        </div>
      </div>

      {error && (
        <div
          className="border-t border-border px-4 py-2 text-xs text-red-500"
          title={error}
        >
          Save failed
        </div>
      )}
    </div>
  )
}
