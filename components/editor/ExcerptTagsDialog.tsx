'use client'

import { useEffect, useRef } from 'react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'

interface ExcerptTagsDialogProps {
  isOpen: boolean
  onClose: () => void
  excerpt: string
  tags: string
  onExcerptChange: (value: string) => void
  onTagsChange: (value: string) => void
  initialFocus?: 'excerpt' | 'tags'
}

export function ExcerptTagsDialog({
  isOpen,
  onClose,
  excerpt,
  tags,
  onExcerptChange,
  onTagsChange,
  initialFocus = 'excerpt',
}: ExcerptTagsDialogProps) {
  const excerptRef = useRef<HTMLTextAreaElement>(null)
  const tagsRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (isOpen) {
      const timer = setTimeout(() => {
        if (initialFocus === 'tags' && tagsRef.current) {
          tagsRef.current.focus()
        } else if (excerptRef.current) {
          excerptRef.current.focus()
        }
      }, 0)
      return () => clearTimeout(timer)
    }
  }, [isOpen, initialFocus])

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        overlayClassName="backdrop-blur-md bg-black/40"
        className="sm:max-w-md"
      >
        <DialogHeader>
          <DialogTitle>Excerpt and Tags</DialogTitle>
          <DialogDescription>
            Add a brief description and tags to help readers find your article.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-4">
          <div className="grid gap-2">
            <Label htmlFor="dialog-excerpt">Excerpt</Label>
            <Textarea
              id="dialog-excerpt"
              ref={excerptRef}
              value={excerpt}
              onChange={(e) => onExcerptChange(e.target.value)}
              placeholder="Brief description of your article (optional)"
              rows={3}
              className="resize-none"
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="dialog-tags">Tags</Label>
            <Input
              id="dialog-tags"
              ref={tagsRef}
              type="text"
              value={tags}
              onChange={(e) => onTagsChange(e.target.value)}
              placeholder="Add tags separated by commas (e.g. rust, programming)"
            />
          </div>
        </div>
        <DialogFooter>
          <Button type="button" onClick={onClose}>
            Done
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
