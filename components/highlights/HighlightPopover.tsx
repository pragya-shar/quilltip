'use client'

import { useRef, useState } from 'react'
import { FocusScope } from '@radix-ui/react-focus-scope'
import { Check, Highlighter, MessageSquare, Lock, Globe } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { HighlightTipButton } from './HighlightTipButton'
import { Id } from '@/convex/_generated/dataModel'
import { useClampedFixedPosition } from '@/hooks/useClampedFixedPosition'
import { useAuth } from '@/components/providers/AuthContext'
import { useHighlightPanelDismiss } from '@/hooks/useHighlightPanelDismiss'
import { useSuspendDialogModalForWallet } from '@/hooks/useSuspendDialogModalForWallet'

interface HighlightPopoverProps {
  position: { top: number; left: number }
  onCreateHighlight: (
    color: string,
    note?: string,
    isPublic?: boolean
  ) => Promise<boolean> | boolean
  onClose: () => void
  onRestoreFocus?: () => void
  selectedText: string
  // Tipping props (optional - only show tip button if article data provided)
  articleId?: Id<'articles'>
  articleSlug?: string
  articleTitle?: string
  authorName?: string
  authorStellarAddress?: string | null
  startOffset?: number
  endOffset?: number
  startContainerPath?: string
  endContainerPath?: string
  selectionStartPosition?: number
  selectionEndPosition?: number
  resumeHighlightTip?: {
    amountCents?: number
    customAmount?: string
  } | null
  onHighlightTipResumeOpened?: () => void
}

const HIGHLIGHT_COLORS = [
  {
    name: 'Amber',
    value: '#F59E0B',
  },
  {
    name: 'Emerald',
    value: '#10B981',
  },
  {
    name: 'Azure',
    value: '#3B82F6',
  },
  {
    name: 'Rose',
    value: '#F43F5E',
  },
  {
    name: 'Violet',
    value: '#8B5CF6',
  },
  {
    name: 'Coral',
    value: '#FB7185',
  },
]

export function HighlightPopover({
  position,
  onCreateHighlight,
  onClose,
  onRestoreFocus,
  selectedText,
  articleId,
  articleSlug,
  authorName,
  authorStellarAddress,
  startOffset,
  endOffset,
  startContainerPath,
  endContainerPath,
  selectionStartPosition,
  selectionEndPosition,
  resumeHighlightTip,
  onHighlightTipResumeOpened,
}: HighlightPopoverProps) {
  const { isAuthenticated } = useAuth()
  const walletConnectionActive = useSuspendDialogModalForWallet()
  const [selectedColor, setSelectedColor] = useState(
    HIGHLIGHT_COLORS[0]?.value || '#F59E0B'
  )
  const [note, setNote] = useState('')
  const [isPublic, setIsPublic] = useState(true)
  const [showNoteInput, setShowNoteInput] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const popoverRef = useRef<HTMLDivElement>(null)
  const clampedPosition = useClampedFixedPosition(position, popoverRef)

  const handleSaveHighlight = async () => {
    if (isSaving) return
    setIsSaving(true)
    try {
      if (await onCreateHighlight(selectedColor, note || undefined, isPublic))
        onClose()
    } finally {
      setIsSaving(false)
    }
  }

  const handleColorSelect = (color: string) => {
    setSelectedColor(color)
    // Just select the color, don't create highlight automatically
  }

  useHighlightPanelDismiss(onClose, !isSaving && !walletConnectionActive)

  return (
    <FocusScope
      trapped={!walletConnectionActive}
      loop
      onUnmountAutoFocus={(event) => {
        event.preventDefault()
        onRestoreFocus?.()
      }}
    >
      <div
        ref={popoverRef}
        data-testid="highlight-popover"
        className="highlight-popover fixed z-50 w-[360px] max-w-[calc(100vw-24px)] p-5 outline-none"
        style={{
          top: clampedPosition.top,
          left: clampedPosition.left,
        }}
        role="dialog"
        aria-modal={!walletConnectionActive}
        aria-label="Create highlight"
        tabIndex={-1}
      >
        <h2 className="highlight-panel-title mb-3">
          {isAuthenticated ? 'Keep this passage' : 'Support this passage'}
        </h2>
        <div className="highlight-text-preview">
          &ldquo;{selectedText.slice(0, 150)}
          {selectedText.length > 150 ? '...' : ''}&rdquo;
        </div>

        {isAuthenticated && (
          <>
            <div className="mb-4">
              <div className="highlight-field-label mb-2">Highlight color</div>
              <div
                className="color-picker-container"
                role="group"
                aria-label="Highlight color"
              >
                {HIGHLIGHT_COLORS.map((color) => (
                  <button
                    key={color.value}
                    onClick={() => handleColorSelect(color.value)}
                    className={cn(
                      'color-picker-button',
                      selectedColor === color.value && 'selected'
                    )}
                    style={{
                      backgroundColor: color.value,
                    }}
                    aria-label={`Select ${color.name} highlight`}
                    aria-pressed={selectedColor === color.value}
                    title={color.name}
                  >
                    {selectedColor === color.value && (
                      <Check className="h-4 w-4" aria-hidden />
                    )}
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
                  showNoteInput && 'is-active'
                )}
                aria-expanded={showNoteInput}
                aria-controls="highlight-creation-note"
              >
                <MessageSquare className="w-4 h-4" />
                <span>{showNoteInput ? 'Hide note' : 'Add note'}</span>
              </button>

              <button
                onClick={() => setIsPublic(!isPublic)}
                className="privacy-toggle"
                aria-label="Public highlight"
                aria-pressed={isPublic}
              >
                {isPublic ? (
                  <>
                    <Globe className="w-4 h-4" />
                    <span>Public</span>
                  </>
                ) : (
                  <>
                    <Lock className="w-4 h-4" />
                    <span>Private</span>
                  </>
                )}
              </button>
            </div>

            {/* Note Input */}
            {showNoteInput && (
              <div className="mb-3">
                <textarea
                  id="highlight-creation-note"
                  aria-label="Highlight note"
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="Add a note to your highlight..."
                  className="highlight-note-input"
                  rows={3}
                  // eslint-disable-next-line jsx-a11y/no-autofocus
                  autoFocus
                />
              </div>
            )}
          </>
        )}

        <p className="mb-4 text-xs text-ui-muted-foreground">
          {isAuthenticated &&
            (isPublic
              ? 'Visible to other readers.'
              : 'Only you can see this highlight.')}
        </p>
        <div className="pt-3 border-t border-ui-border">
          <div className="text-xs text-ui-muted-foreground mb-3 text-center">
            {isAuthenticated
              ? `Save highlight${
                  articleId &&
                  articleSlug &&
                  authorStellarAddress &&
                  startOffset !== undefined &&
                  endOffset !== undefined
                    ? ' or tip the author'
                    : ''
                }`
              : 'Tip the author for this selection'}
          </div>

          <div className="highlight-save-actions mb-3">
            {isAuthenticated && (
              <Button
                type="button"
                size="sm"
                onClick={handleSaveHighlight}
                disabled={isSaving}
                className="min-w-0 min-h-11 flex-1 gap-2"
              >
                <Highlighter className="w-4 h-4" />
                <span className="font-medium">
                  {isSaving ? 'Saving…' : 'Save highlight'}
                </span>
              </Button>
            )}

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
                  startContainerPath={startContainerPath}
                  endContainerPath={endContainerPath}
                  selectionStartPosition={selectionStartPosition}
                  selectionEndPosition={selectionEndPosition}
                  className="min-w-0 min-h-11 flex-1"
                  resumeOpen={Boolean(resumeHighlightTip)}
                  resumeAmountCents={resumeHighlightTip?.amountCents}
                  resumeCustomAmount={resumeHighlightTip?.customAmount}
                  onResumeDialogVisible={() => {
                    if (resumeHighlightTip) {
                      onHighlightTipResumeOpened?.()
                    }
                  }}
                  onSuccess={
                    isAuthenticated
                      ? () => {
                          void handleSaveHighlight()
                        }
                      : undefined
                  }
                />
              )}
          </div>

          {/* Close Button */}
          <button
            onClick={onClose}
            disabled={isSaving}
            className="highlight-quiet-action w-full"
          >
            Cancel
          </button>
        </div>
      </div>
    </FocusScope>
  )
}
