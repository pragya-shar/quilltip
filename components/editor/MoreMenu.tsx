'use client'

import { useEffect, useRef, useState, type RefObject } from 'react'
import { Editor } from '@tiptap/react'
import {
  Undo2,
  Redo2,
  MoreHorizontal,
  Trash2,
  Clock,
  LetterText,
  Loader2,
  ImageIcon,
  AlignLeft,
  ChevronDown,
} from 'lucide-react'
import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import { cn } from '@/lib/utils'
import { estimateReadingMinutes } from '@/lib/reading-time'
import { Collapsible, CollapsibleContent } from '@/components/ui/collapsible'
import { Textarea } from '@/components/ui/textarea'
import { focusRing } from '@/components/editor/EditorActionBarShared'
import { NotesMenuSection } from '@/components/editor/NotesMenuSection'
import { MobileNotesDrawer } from '@/components/editor/MobileNotesDrawer'

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

const DEFAULT_EXCERPT_MAX_CHARS = 500

export function MoreMenu({
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
  notes = '',
  onNotesChange,
  notesOpen = false,
  onNotesOpenChange,
  notesTextareaRef,
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
  notes?: string
  onNotesChange?: (value: string) => void
  notesOpen?: boolean
  onNotesOpenChange?: (open: boolean) => void
  notesTextareaRef?: RefObject<HTMLTextAreaElement | null>
  moreMenuOpen?: boolean
  onMoreMenuOpenChange?: (open: boolean) => void
  excerptMaxChars?: number
  isActive?: boolean
}) {
  const canUndo = editor?.can().undo() ?? false
  const canRedo = editor?.can().redo() ?? false
  const shortcuts = useUndoRedoShortcuts()
  const [internalOpen, setInternalOpen] = useState(false)
  const [mobileNotesOpen, setMobileNotesOpen] = useState(false)
  const moreTriggerRef = useRef<HTMLButtonElement>(null)
  const menuOpen = isActive && (moreMenuOpen ?? internalOpen)
  const excerptLabel = excerpt.trim() ? 'Edit excerpt' : 'Add excerpt'

  const handleOpenChange = (open: boolean) => {
    if (!isActive) return
    if (onMoreMenuOpenChange) {
      onMoreMenuOpenChange(open)
    } else {
      setInternalOpen(open)
    }
    if (!open) {
      onExcerptOpenChange?.(false)
      onNotesOpenChange?.(false)
    }
  }

  const closeMenu = () => {
    handleOpenChange(false)
  }

  const openMobileNotes = () => {
    closeMenu()
    setMobileNotesOpen(true)
  }

  return (
    <>
      <DropdownMenu.Root open={menuOpen} onOpenChange={handleOpenChange}>
        <DropdownMenu.Trigger asChild>
          <button
            ref={moreTriggerRef}
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
              excerptOpen || notesOpen ? 'min-w-[280px]' : 'min-w-[180px]'
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
                        Optional. Shown on article cards when provided.
                        Otherwise, the opening text becomes the preview.
                      </p>
                      <Textarea
                        ref={excerptTextareaRef}
                        id="article-excerpt"
                        value={excerpt}
                        onChange={(event) =>
                          onExcerptChange(event.target.value)
                        }
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
            {onNotesChange && onNotesOpenChange && notesTextareaRef ? (
              <>
                <DropdownMenu.Separator className="h-px bg-border my-1" />
                <NotesMenuSection
                  notes={notes}
                  onNotesChange={onNotesChange}
                  notesOpen={notesOpen}
                  onNotesOpenChange={onNotesOpenChange}
                  notesTextareaRef={notesTextareaRef}
                  onOpenMobileNotes={openMobileNotes}
                />
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
      {onNotesChange && notesTextareaRef ? (
        <MobileNotesDrawer
          open={mobileNotesOpen}
          onOpenChange={setMobileNotesOpen}
          notes={notes}
          onNotesChange={onNotesChange}
          notesTextareaRef={notesTextareaRef}
          returnFocusRef={moreTriggerRef}
        />
      ) : null}
    </>
  )
}
