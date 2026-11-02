'use client'

import { useState } from 'react'
import { FocusScope } from '@radix-ui/react-focus-scope'
import { Highlighter, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { HighlightTipButton } from './HighlightTipButton'
import { Id } from '@/convex/_generated/dataModel'
import { HighlightPaperSlip } from './HighlightPaperSlip'
import { useAuth } from '@/components/providers/AuthContext'
import { useHighlightPanelDismiss } from '@/hooks/useHighlightPanelDismiss'
import { useSuspendDialogModalForWallet } from '@/hooks/useSuspendDialogModalForWallet'

interface HighlightPopoverProps {
  position: { top: number; left: number }
  onCreateHighlight: (
    color: string,
    note?: string,
    isPublic?: boolean,
    keepOpen?: boolean
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
  onSignInToSave: () => void
}

export function HighlightPopover({
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
  onSignInToSave,
}: HighlightPopoverProps) {
  const { isAuthenticated } = useAuth()
  const walletConnectionActive = useSuspendDialogModalForWallet()
  const [isSaving, setIsSaving] = useState(false)
  const [error, setError] = useState('')

  const handleSaveHighlight = async (keepOpen = false) => {
    if (!isAuthenticated) {
      onSignInToSave()
      return false
    }
    if (isSaving) return false
    setIsSaving(true)
    setError('')
    try {
      const saved = await onCreateHighlight(
        '#F59E0B',
        undefined,
        true,
        keepOpen
      )
      if (saved && !keepOpen) onClose()
      if (!saved)
        setError(
          'Your highlight could not be saved. Your words are still here; try again.'
        )
      return saved
    } catch {
      setError(
        'Your highlight could not be saved. Your words are still here; try again.'
      )
      return false
    } finally {
      setIsSaving(false)
    }
  }

  useHighlightPanelDismiss(onClose, !isSaving && !walletConnectionActive)

  return (
    <HighlightPaperSlip>
      <FocusScope
        trapped={!walletConnectionActive}
        loop
        onUnmountAutoFocus={(event) => {
          event.preventDefault()
          onRestoreFocus?.()
        }}
      >
        <div
          data-testid="highlight-popover"
          className="highlight-popover passage-slip fixed z-50 w-[560px] max-w-[calc(100vw-24px)] outline-none"
          role="dialog"
          aria-modal={!walletConnectionActive}
          aria-label="Create highlight"
          tabIndex={-1}
        >
          <button
            type="button"
            className="highlight-quiet-action slip-close"
            aria-label="Close highlight"
            onClick={onClose}
            disabled={isSaving}
          >
            <X aria-hidden className="h-5 w-5" />
          </button>
          <p className="slip-meta">QuillTip · Your reading notes</p>
          <p className="slip-label">A passage you picked</p>
          <h2 className="slip-title">Keep these words.</h2>
          {/* eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- Scrollable quotes need keyboard access. */}
          <blockquote className="slip-quote" tabIndex={0}>
            {selectedText}
          </blockquote>
          <div className="slip-actions">
            <Button
              type="button"
              className="slip-action"
              onClick={() => void handleSaveHighlight()}
              disabled={isSaving}
            >
              <Highlighter aria-hidden className="h-4 w-4" />
              {isSaving ? 'Saving…' : 'Highlight only'}
            </Button>
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
                  className="slip-action"
                  label="Highlight & tip"
                  disabled={isSaving}
                  onBeforeOpen={
                    isAuthenticated
                      ? () => handleSaveHighlight(true)
                      : undefined
                  }
                  resumeOpen={Boolean(resumeHighlightTip)}
                  resumeAmountCents={resumeHighlightTip?.amountCents}
                  resumeCustomAmount={resumeHighlightTip?.customAmount}
                  onResumeDialogVisible={() => {
                    if (resumeHighlightTip) {
                      onHighlightTipResumeOpened?.()
                    }
                  }}
                />
              )}
          </div>
          {error && (
            <p role="alert" className="slip-error">
              {error}
            </p>
          )}
          <p className="slip-aside">
            A highlight is enough. A tip is up to you.
          </p>
        </div>
      </FocusScope>
    </HighlightPaperSlip>
  )
}
