'use client'

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import type { DraftSortKey } from '@/lib/drafts/draftMetadata'

type DraftsSortControlProps = {
  value: DraftSortKey
  onChange: (value: DraftSortKey) => void
}

export function DraftsSortControl({ value, onChange }: DraftsSortControlProps) {
  return (
    <div className="flex items-center gap-2 text-sm text-muted-foreground">
      <span className="shrink-0">Sort by</span>
      <Select
        value={value}
        onValueChange={(next) => onChange(next as DraftSortKey)}
      >
        <SelectTrigger className="h-8 w-[140px] bg-background">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="updatedAt">Last edited</SelectItem>
          <SelectItem value="createdAt">Created</SelectItem>
        </SelectContent>
      </Select>
    </div>
  )
}
