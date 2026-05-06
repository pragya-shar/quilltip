'use client'

import { useMemo, useRef, useState, useEffect } from 'react'
import { FocusScope } from '@radix-ui/react-focus-scope'
import { Highlighter, MessageSquare, Lock, Globe } from 'lucide-react'
import { cn } from '@/lib/utils'
import { HighlightTipButton } from './HighlightTipButton'
import { Id } from '@/convex/_generated/dataModel'

interface HighlightPopoverProps {
  position: { top: number; left: number }
  onCreateHighlight: (color: string, note?: string, isPublic?: boolean) => void
  onClose: () => void
  selectedText: string
  // Tipping props (optional - only show tip button if article data provided)
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
  position,
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
  const popoverRef = useRef<HTMLDivElement>(null)

  const [computedPosition, setComputedPosition] = useState(position)

  useEffect(() => {
    setComputedPosition(position)
  }, [position.top, position.left])

  const clampedPosition = useMemo(() => {
    const clamp = (v: number, min: number, max: number) =>
      Math.min(max, Math.max(min, v))

    const margin = 12
    const rect = popoverRef.current?.getBoundingClientRect()
    const width = rect?.width ?? 320
    const height = rect?.height ?? 260

    // `left`/`top` are popover's top-left corner.
    const minLeft = margin
    const maxLeft = window.innerWidth - margin - width
    const left = clamp(computedPosition.left, minLeft, Math.max(minLeft, maxLeft))

    // `position.top` comes in as the anchor Y (mid-line) next to the selection end.
    const desiredTop = computedPosition.top - height / 2
    const minTop = margin
    const maxTop = window.innerHeight - margin - height
    const top = clamp(desiredTop, minTop, Math.max(minTop, maxTop))

    return { top, left }
  }, [computedPosition.left, computedPosition.top])

  const handleSaveHighlight = () => {
    onCreateHighlight(selectedColor, note || undefined, isPublic)
    onClose()
  }

  const handleColorSelect = (color: string) => {
    setSelectedColor(color)
    // Just select the color, don't create highlight automatically
  }

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.preventDefault()
      e.stopPropagation()
      onClose()
    }
    document.addEventListener('keydown', onKeyDown, true)
    return () => document.removeEventListener('keydown', onKeyDown, true)
  }, [onClose])

  return (
    <FocusScope trapped loop>
      <div
        ref={popoverRef}
        className="highlight-popover fixed z-50 w-[360px] max-w-[calc(100vw-24px)] rounded-2xl p-4 outline-none"
        style={{
          top: clampedPosition.top,
          left: clampedPosition.left,
        }}
        role="dialog"
        aria-modal="true"
        aria-label="Create highlight"
        tabIndex={-1}
      >
        {/* Text Preview */}
        <div className="highlight-text-preview">
          &ldquo;{selectedText.slice(0, 150)}
          {selectedText.length > 150 ? '...' : ''}&rdquo;
        </div>

        {/* Color Picker */}
        <div className="mb-4">
          <div className="text-xs font-medium text-muted-foreground mb-2">
            Choose Highlight Color
          </div>
          <div className="color-picker-container">
            {PREMIUM_HIGHLIGHT_COLORS.map((color) => (
              <button
                key={color.value}
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

        {/* Actions */}
        <div className="flex items-center gap-2 mb-3">
          <button
            onClick={() => setShowNoteInput(!showNoteInput)}
            className={cn(
              'highlight-action-button flex items-center gap-2',
              'bg-muted hover:bg-muted/80 text-foreground',
              showNoteInput && 'bg-muted/90'
            )}
          >
            <MessageSquare className="w-4 h-4" />
            <span>Add Note</span>
          </button>

          <button
            onClick={() => setIsPublic(!isPublic)}
            className="privacy-toggle"
          >
            {isPublic ? (
              <>
                <Globe className="w-4 h-4 text-green-800 dark:text-green-300" />
                <span className="text-sm text-foreground">Public</span>
              </>
            ) : (
              <>
                <Lock className="w-4 h-4 text-muted-foreground" />
                <span className="text-sm text-foreground">Private</span>
              </>
            )}
          </button>
        </div>

        {/* Note Input */}
        {showNoteInput && (
          <div className="mb-3">
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Add a note to your highlight..."
              className="w-full px-3 py-2 text-sm border border-input bg-background text-foreground rounded-lg focus:ring-2 focus:ring-ring focus:border-transparent resize-none"
              rows={3}
              // eslint-disable-next-line jsx-a11y/no-autofocus
              autoFocus
            />
          </div>
        )}

        {/* Action Buttons Section */}
        <div className="pt-3 border-t border-border">
          <div className="text-xs font-medium text-muted-foreground mb-3 text-center">
            Save highlight{' '}
            {articleId &&
              articleSlug &&
              authorStellarAddress &&
              startOffset !== undefined &&
              endOffset !== undefined &&
              'or tip the author'}
          </div>

          <div className="flex gap-2 mb-3">
            {/* Save Highlight Button */}
            <button
              onClick={handleSaveHighlight}
              className="highlight-action-button flex-1 bg-gradient-to-r from-blue-500 to-blue-600 text-white hover:from-blue-600 hover:to-blue-700 flex items-center justify-center"
            >
              <Highlighter className="w-4 h-4 mr-2" />
              <span>Save</span>
            </button>

            {/* Tip Highlight Button - Show if article data is available */}
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
                    // Create highlight with selected settings, then close
                    onCreateHighlight(
                      selectedColor,
                      note || undefined,
                      isPublic
                    )
                    onClose()
                  }}
                />
              )}
          </div>

          {/* Close Button */}
          <button
            onClick={onClose}
            className="w-full text-center text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            Cancel
          </button>
        </div>
      </div>
    </FocusScope>
  )
}
