'use client'

import { type RefObject } from 'react'
import { FileText, ChevronDown } from 'lucide-react'
import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import { useIsMobile } from '@/hooks/use-mobile'
import { cn } from '@/lib/utils'
import { Collapsible, CollapsibleContent } from '@/components/ui/collapsible'
import { WriterNotesPanel } from '@/components/editor/WriterNotesPanel'

export function NotesMenuSection({
  notes,
  onNotesChange,
  notesOpen,
  onNotesOpenChange,
  notesTextareaRef,
  onOpenMobileNotes,
}: {
  notes: string
  onNotesChange: (value: string) => void
  notesOpen: boolean
  onNotesOpenChange: (open: boolean) => void
  notesTextareaRef: RefObject<HTMLTextAreaElement | null>
  onOpenMobileNotes: () => void
}) {
  const isMobile = useIsMobile()

  if (isMobile) {
    return (
      <DropdownMenu.Item
        className="px-4 py-2.5 text-sm text-foreground outline-none flex cursor-pointer flex-col items-start gap-0.5 hover:bg-muted focus:bg-muted"
        onSelect={(event) => {
          event.preventDefault()
          onOpenMobileNotes()
        }}
      >
        <span className="flex items-center gap-2">
          <FileText className="h-4 w-4 shrink-0" />
          <span>Personal notes</span>
        </span>
        <span className="pl-6 text-[11px] leading-snug text-muted-foreground">
          Private, not published
        </span>
      </DropdownMenu.Item>
    )
  }

  return (
    <Collapsible open={notesOpen} onOpenChange={onNotesOpenChange}>
      <DropdownMenu.Item
        className="px-4 py-2.5 text-sm text-foreground outline-none flex cursor-pointer items-center justify-between gap-2 hover:bg-muted focus:bg-muted data-[highlighted]:bg-muted"
        onSelect={(event) => {
          event.preventDefault()
          const nextOpen = !notesOpen
          onNotesOpenChange(nextOpen)
          if (nextOpen) {
            window.setTimeout(() => notesTextareaRef.current?.focus(), 0)
          }
        }}
      >
        <span className="flex min-w-0 flex-col items-start gap-0.5">
          <span className="flex items-center gap-2">
            <FileText className="h-4 w-4 shrink-0" />
            <span>Personal notes</span>
          </span>
          <span className="pl-6 text-[11px] leading-snug text-muted-foreground">
            Private, not published
          </span>
        </span>
        <ChevronDown
          className={cn(
            'h-3.5 w-3.5 shrink-0 transition-transform',
            notesOpen && 'rotate-180'
          )}
        />
      </DropdownMenu.Item>
      <CollapsibleContent>
        <div
          className="space-y-2 border-t border-border px-3 pb-3 pt-2"
          onPointerDown={(event) => event.stopPropagation()}
        >
          <WriterNotesPanel
            ref={notesTextareaRef}
            notes={notes}
            onNotesChange={onNotesChange}
            showHeader={false}
            textareaClassName="min-h-[6rem] resize-none text-sm"
          />
        </div>
      </CollapsibleContent>
    </Collapsible>
  )
}
