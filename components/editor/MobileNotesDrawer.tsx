'use client'

import { type RefObject } from 'react'
import { cn } from '@/lib/utils'
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
import { focusRing } from '@/components/editor/EditorActionBarShared'

export function MobileNotesDrawer({
  open,
  onOpenChange,
  notes,
  onNotesChange,
  notesTextareaRef,
  returnFocusRef,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  notes: string
  onNotesChange: (value: string) => void
  notesTextareaRef: RefObject<HTMLTextAreaElement | null>
  returnFocusRef: RefObject<HTMLButtonElement | null>
}) {
  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent
        className="max-h-[min(70dvh,32rem)] gap-0 overflow-y-auto px-0 pb-6"
        onOpenAutoFocus={(e) => {
          e.preventDefault()
          notesTextareaRef.current?.focus()
        }}
        onCloseAutoFocus={(e) => {
          e.preventDefault()
          returnFocusRef.current?.focus()
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
