'use client'

import { useState } from 'react'
import { Highlighter, MessageSquare, Lock, Globe } from 'lucide-react'
import { cn } from '@/lib/utils'
import { HighlightTipButton } from './HighlightTipButton'
import { Id } from '@/convex/_generated/dataModel'

interface HighlightPopoverProps {
  onCreateHighlight: (color: string, note?: string, isPublic?: boolean) => void
  onClose: () => void
  selectedText: string
  articleId?: Id<'articles'>
  articleSlug?: string
  articleTitle?: string
  authorName?: string
  authorStellarAddress?: string | null
  startOffset?: number
  endOffset?: number
}

const PREMIUM_HIGHLIGHT_COLORS = [
  {
    name: 'Amber',
    value: '#F59E0B',
    rgb: '245, 158, 11',
    description: 'Warm & Inviting',
  },
  {
    name: 'Emerald',
    value: '#10B981',
    rgb: '16, 185, 129',
    description: 'Fresh & Natural',
  },
  {
    name: 'Azure',
    value: '#3B82F6',
    rgb: '59, 130, 246',
    description: 'Deep & Trustworthy',
  },
  {
    name: 'Rose',
    value: '#F43F5E',
    rgb: '244, 63, 94',
    description: 'Elegant & Bold',
  },
  {
    name: 'Violet',
    value: '#8B5CF6',
    rgb: '139, 92, 246',
    description: 'Royal & Creative',
  },
  {
    name: 'Coral',
    value: '#FB7185',
    rgb: '251, 113, 133',
    description: 'Soft & Playful',
  },
]

export function HighlightPopover({
  onCreateHighlight,
  onClose,
  selectedText,
  articleId,
  articleSlug,
  authorName,
  authorStellarAddress,
  startOffset,
  endOffset,
}: HighlightPopoverProps) {
  const [selectedColor, setSelectedColor] = useState(
    PREMIUM_HIGHLIGHT_COLORS[0]?.value || '#F59E0B'
  )
  const [note, setNote] = useState('')
  const [isPublic, setIsPublic] = useState(true)
  const [showNoteInput, setShowNoteInput] = useState(false)

  const handleSaveHighlight = () => {
    onCreateHighlight(selectedColor, note || undefined, isPublic)
    onClose()
  }

  const handleColorSelect = (color: string) => {
    setSelectedColor(color)
  }

  return (
    <div className="highlight-popover min-w-[320px] rounded-2xl p-4">
      <div className="highlight-text-preview">
        &ldquo;{selectedText.slice(0, 150)}
        {selectedText.length > 150 ? '...' : ''}&rdquo;
      </div>

      <div className="mb-4">
        <div className="mb-2 text-xs font-medium text-muted-foreground">
          Choose Highlight Color
        </div>
        <div className="color-picker-container">
          {PREMIUM_HIGHLIGHT_COLORS.map((color) => (
            <button
              key={color.value}
              type="button"
              onClick={() => handleColorSelect(color.value)}
              className={cn(
                'color-picker-button',
                selectedColor === color.value && 'selected'
              )}
              style={{
                background: `linear-gradient(135deg, ${color.value}, ${color.value}dd)`,
              }}
              aria-label={`Select ${color.name} highlight`}
            >
              <div className="color-tooltip">
                <div className="font-medium">{color.name}</div>
                <div className="text-xs opacity-80">{color.description}</div>
                <div className="color-tooltip-arrow" />
              </div>
            </button>
          ))}
        </div>
      </div>

      <div className="mb-3 flex items-center gap-2">
        <button
          type="button"
          onClick={() => setShowNoteInput(!showNoteInput)}
          className={cn(
            'highlight-action-button flex items-center gap-2',
            'bg-muted text-foreground hover:bg-muted/80',
            showNoteInput && 'bg-muted/90'
          )}
        >
          <MessageSquare className="h-4 w-4" />
          <span>Add Note</span>
        </button>

        <button
          type="button"
          onClick={() => setIsPublic(!isPublic)}
          className="privacy-toggle"
        >
          {isPublic ? (
            <>
              <Globe className="h-4 w-4 text-green-600" />
              <span className="text-sm text-foreground">Public</span>
            </>
          ) : (
            <>
              <Lock className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm text-foreground">Private</span>
            </>
          )}
        </button>
      </div>

      {showNoteInput && (
        <div className="mb-3">
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Add a note to your highlight..."
            className="w-full resize-none rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground focus:border-transparent focus:ring-2 focus:ring-ring"
            rows={3}
            // eslint-disable-next-line jsx-a11y/no-autofocus
            autoFocus
          />
        </div>
      )}

      <div className="border-t border-border pt-3">
        <div className="mb-3 text-center text-xs font-medium text-muted-foreground">
          Save highlight{' '}
          {articleId &&
            articleSlug &&
            authorStellarAddress &&
            startOffset !== undefined &&
            endOffset !== undefined &&
            'or tip the author'}
        </div>

        <div className="mb-3 flex gap-2">
          <button
            type="button"
            onClick={handleSaveHighlight}
            className="highlight-action-button flex flex-1 items-center justify-center bg-gradient-to-r from-blue-500 to-blue-600 text-white hover:from-blue-600 hover:to-blue-700"
          >
            <Highlighter className="mr-2 h-4 w-4" />
            <span>Save</span>
          </button>

          {articleId &&
            articleSlug &&
            authorStellarAddress &&
            startOffset !== undefined &&
            endOffset !== undefined && (
              <HighlightTipButton
                articleId={articleId}
                articleSlug={articleSlug}
                authorName={authorName || 'Author'}
                authorStellarAddress={authorStellarAddress}
                highlightText={selectedText}
                startOffset={startOffset}
                endOffset={endOffset}
                className="flex-1"
                onSuccess={() => {
                  onCreateHighlight(selectedColor, note || undefined, isPublic)
                  onClose()
                }}
              />
            )}
        </div>

        <button
          type="button"
          onClick={onClose}
          className="w-full text-center text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          Cancel
        </button>
      </div>
    </div>
  )
}
