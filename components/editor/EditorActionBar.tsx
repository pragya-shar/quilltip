'use client'

import { Editor } from '@tiptap/react'
import {
  ArrowLeft,
  Undo2,
  Redo2,
  MoreHorizontal,
  Trash2,
  Clock,
  LetterText,
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
}: EditorActionBarProps) {
  const canUndo = editor?.can().undo ?? false
  const canRedo = editor?.can().redo ?? false
  const savedAtText = lastSavedAt
    ? lastSavedAt.toLocaleTimeString(undefined, {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      })
    : null

  return (
    <div className="flex items-center justify-between w-full gap-4 py-3 px-4 bg-white border-b border-gray-200 shadow-sm">
      {/* Left: Back */}
      <button
        type="button"
        onClick={onBack}
        className="flex items-center gap-2 text-gray-600 hover:text-gray-900 font-medium transition-colors"
      >
        <ArrowLeft className="h-4 w-4" />
        Back
      </button>

      {/* Right: Actions */}
      <div className="flex items-center gap-2">
        {/* Undo / Redo */}
        <button
          type="button"
          onClick={() => editor?.chain().focus().undo().run()}
          disabled={!canUndo}
          className="p-2 rounded-md text-gray-600 hover:bg-gray-100 hover:text-gray-900 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent transition-colors"
          title="Undo"
        >
          <Undo2 className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={() => editor?.chain().focus().redo().run()}
          disabled={!canRedo}
          className="p-2 rounded-md text-gray-400 hover:bg-gray-100 hover:text-gray-600 disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:bg-transparent transition-colors"
          title="Redo"
        >
          <Redo2 className="h-4 w-4" />
        </button>

        <div className="w-px h-6 bg-gray-200 mx-1" />

        {/* Draft pill (light yellow, dot indicator) + Not saved yet / Saved at */}
        <span className="flex items-center gap-2 text-sm">
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-yellow-100 text-amber-800 font-medium">
            <span
              className="w-1.5 h-1.5 rounded-full bg-amber-500 shrink-0"
              aria-hidden
            />
            Draft
          </span>
          {savedAtText != null ? (
            <span className="text-gray-500">Saved at {savedAtText}</span>
          ) : (
            <span className="text-gray-400">Not saved yet</span>
          )}
        </span>

        <div className="w-px h-6 bg-gray-200 mx-1" />

        {/* Save - always clickable so user can manually save even after auto-save */}
        <button
          type="button"
          onClick={onSave}
          disabled={isSaving}
          className="px-3 py-1.5 text-sm font-medium text-gray-600 hover:text-gray-900 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-transparent rounded transition-colors"
          title="Save draft"
        >
          {isSaving ? 'Saving...' : 'Save'}
        </button>

        {/* Preview */}
        {onPreview && (
          <>
            <div className="w-px h-6 bg-gray-200 mx-1" />
            <button
              type="button"
              onClick={onPreview}
              className="px-3 py-1.5 text-sm text-gray-400 hover:text-gray-600 hover:bg-gray-50 rounded transition-colors"
              title="Preview"
            >
              Preview
            </button>
          </>
        )}

        {/* Publish */}
        <div className="w-px h-6 bg-gray-200 mx-1" />
        {isPublished ? (
          <span className="px-4 py-2 text-sm font-medium text-green-700 bg-green-50 rounded-full">
            Published
          </span>
        ) : (
          <button
            type="button"
            onClick={onPublish}
            disabled={isPublishing || !canPublish}
            className="px-5 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed rounded-full transition-colors"
            title="Publish article"
          >
            {isPublishing ? 'Publishing...' : 'Publish'}
          </button>
        )}

        {/* More options */}
        <DropdownMenu.Root>
          <DropdownMenu.Trigger asChild>
            <button
              type="button"
              className="p-2 rounded-full border border-gray-200 text-gray-600 hover:bg-gray-50 hover:border-gray-300 transition-colors"
              title="More options"
            >
              <MoreHorizontal className="h-4 w-4" />
            </button>
          </DropdownMenu.Trigger>
          <DropdownMenu.Portal>
            <DropdownMenu.Content
              className="bg-white rounded-lg shadow-lg border border-gray-200 py-1 z-50 min-w-[180px]"
              sideOffset={4}
              align="end"
            >
              <DropdownMenu.Item
                className="px-4 py-2.5 text-sm text-gray-500 outline-none flex items-center gap-2"
                onSelect={(e) => e.preventDefault()}
              >
                <LetterText className="w-4 h-4 shrink-0" />
                {editor?.getText().split(/\s+/).filter(Boolean).length ??
                  0}{' '}
                words
              </DropdownMenu.Item>
              <DropdownMenu.Item
                className="px-4 py-2.5 text-sm text-gray-500 outline-none flex items-center gap-2"
                onSelect={(e) => e.preventDefault()}
              >
                <Clock className="w-4 h-4 shrink-0" />~
                {Math.max(
                  1,
                  Math.ceil(
                    (editor?.getText().split(/\s+/).filter(Boolean).length ??
                      0) / 200
                  )
                )}{' '}
                min read
              </DropdownMenu.Item>
              {onDelete && (
                <>
                  <DropdownMenu.Separator className="h-px bg-gray-200 my-1" />
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
      </div>

      {/* Save error indicator */}
      {error && (
        <span className="text-xs text-red-500" title={error}>
          Save failed
        </span>
      )}
    </div>
  )
}
