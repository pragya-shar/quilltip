'use client'

import { forwardRef } from 'react'
import { cn } from '@/lib/utils'

export interface WriterNotesPanelProps {
  notes: string
  onNotesChange?: (value: string) => void
  className?: string
  textareaClassName?: string
  showHeader?: boolean
}

export const WRITER_NOTES_HELPER_TEXT =
  'Private planning notes for you only. They are saved with this draft and are not published with your article.'

export const WriterNotesPanel = forwardRef<
  HTMLTextAreaElement,
  WriterNotesPanelProps
>(function WriterNotesPanel(
  { notes, onNotesChange, className, textareaClassName, showHeader = true },
  ref
) {
  return (
    <div className={cn(className)}>
      {showHeader ? (
        <div className="border-b border-border px-3 py-2">
          <p className="text-xs font-medium text-muted-foreground">
            Personal Notes
          </p>
          <p className="mt-1 text-xs leading-snug text-muted-foreground/80">
            {WRITER_NOTES_HELPER_TEXT}
          </p>
        </div>
      ) : null}
      <textarea
        ref={ref}
        value={notes}
        onChange={(e) => onNotesChange?.(e.target.value)}
        placeholder="Jot down ideas, reminders, or notes..."
        aria-label="Personal notes"
        className={cn(
          'w-full resize-none bg-popover p-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring',
          textareaClassName
        )}
        rows={6}
      />
    </div>
  )
})
