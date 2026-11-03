'use client'

import { useRef, useState } from 'react'
import { useMutation, useQuery } from 'convex/react'
import { api } from '@/convex/_generated/api'
import type { Id } from '@/types/convex'
import { FocusScope } from '@radix-ui/react-focus-scope'
import { Heart, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { HighlightTipButton } from './HighlightTipButton'
import { toast } from 'sonner'
import { useHighlightPanelDismiss } from '@/hooks/useHighlightPanelDismiss'
import { useSuspendDialogModalForWallet } from '@/hooks/useSuspendDialogModalForWallet'
import { HighlightPaperSlip } from './HighlightPaperSlip'

interface HighlightDetailsPanelProps {
  highlight: {
    _id: Id<'highlights'>
    text: string
    startOffset: number
    endOffset: number
    startContainerPath: string
    endContainerPath: string
    highlightId: string
    color?: string
    note?: string
    isPublic: boolean
    userId: Id<'users'>
    userName?: string
    userAvatar?: string
    createdAt: number
  }
  position: { top: number; left: number }
  onClose: () => void
  onRestoreFocus?: () => void
  onDeleted?: (highlightId: Id<'highlights'>) => void
  currentUserId?: Id<'users'>
  // Article data for tipping
  articleId?: Id<'articles'>
  articleSlug?: string
  authorName?: string
  authorStellarAddress?: string | null
}

export function HighlightDetailsPanel({
  highlight,
  onClose,
  onRestoreFocus,
  onDeleted,
  currentUserId,
  articleId,
  articleSlug,
  authorName,
  authorStellarAddress,
}: HighlightDetailsPanelProps) {
  const walletConnectionActive = useSuspendDialogModalForWallet()
  const closeRef = useRef<HTMLButtonElement>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [note, setNote] = useState(highlight.note ?? '')
  const [savedNote, setSavedNote] = useState(highlight.note ?? '')
  const context = useQuery(api.highlights.getPassageContext, {
    id: highlight._id,
  })
  const remove = useMutation(api.highlights.deleteHighlight)
  const restore = useMutation(api.highlights.restoreHighlight)
  const appreciate = useMutation(api.highlights.setPassageAppreciation)
  const create = useMutation(api.highlights.createHighlight)
  const update = useMutation(api.highlights.updateHighlight)
  const isOwner = currentUserId === highlight.userId
  useHighlightPanelDismiss(onClose, !busy && !walletConnectionActive)

  const run = async (operation: () => Promise<void>) => {
    if (busy) return
    setBusy(true)
    setError('')
    try {
      await operation()
    } catch {
      setError('Your change could not be saved. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  const removePersonal = () =>
    run(async () => {
      const id = context?.personalId
      if (!id) return
      await remove({ id })
      onDeleted?.(id)
      onClose()
      toast('Highlight removed.', {
        duration: 10000,
        action: {
          label: 'Undo',
          onClick: () => {
            void restore({ id })
              .then(() => toast.success('Highlight restored.'))
              .catch(() => {
                toast.error('Could not restore your highlight.', {
                  action: {
                    label: 'Retry undo',
                    onClick: () => {
                      void restore({ id }).catch(() =>
                        toast.error(
                          'Could not restore your highlight. Please try saving the passage again.'
                        )
                      )
                    },
                  },
                })
              })
          },
        },
      })
    })

  return (
    <HighlightPaperSlip>
      <div
        className="highlight-details-panel passage-slip fixed z-50 w-[560px] max-w-[calc(100vw-24px)] outline-none"
        role="dialog"
        aria-modal={!walletConnectionActive}
        aria-label="Highlight details"
        tabIndex={-1}
      >
        <FocusScope
          trapped={!walletConnectionActive}
          loop
          onMountAutoFocus={(event) => {
            event.preventDefault()
            closeRef.current?.focus()
          }}
          onUnmountAutoFocus={(event) => {
            event.preventDefault()
            onRestoreFocus?.()
          }}
        >
          <button
            ref={closeRef}
            type="button"
            className="highlight-quiet-action slip-close"
            aria-label="Close highlight details"
            onClick={onClose}
            disabled={busy}
          >
            <X aria-hidden className="h-5 w-5" />
          </button>
          <p className="slip-meta">QuillTip · Your reading notes</p>
          <p className="slip-label">
            {context?.personalId || isOwner
              ? 'In your highlights'
              : 'Highlighted by another reader'}
          </p>
          <h2 className="slip-title">A line to return to.</h2>
          {/* eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- Scrollable quotes need keyboard access. */}
          <blockquote className="slip-quote" tabIndex={0}>
            {highlight.text}
          </blockquote>
          <p className="slip-shared" aria-live="polite">
            {context === undefined
              ? 'Loading shared-reader context…'
              : context && context.otherReaderCount > 0
                ? `${context.countIsLowerBound ? 'At least ' : ''}${context.otherReaderCount} other ${context.otherReaderCount === 1 ? 'reader highlighted' : 'readers highlighted'} these words`
                : 'No other public highlights of these words yet.'}
          </p>
          <div className="slip-actions">
            <Button
              type="button"
              className="slip-action"
              onClick={onClose}
              disabled={busy}
            >
              Keep reading
            </Button>
            <Button
              type="button"
              className="slip-action"
              aria-pressed={context?.appreciated ?? false}
              disabled={busy || !context || !currentUserId}
              onClick={() =>
                void run(async () => {
                  await appreciate({
                    id: highlight._id,
                    appreciated: !context?.appreciated,
                  })
                })
              }
            >
              <Heart aria-hidden className="h-4 w-4" />
              {context?.appreciated ? 'Appreciated' : 'Appreciate for free'}
            </Button>
            {context?.personalId || (context === undefined && isOwner) ? (
              <Button
                type="button"
                className="slip-action"
                disabled={busy}
                onClick={() => void removePersonal()}
              >
                Remove highlight
              </Button>
            ) : (
              currentUserId &&
              articleId && (
                <Button
                  type="button"
                  className="slip-action"
                  disabled={busy || !context}
                  onClick={() =>
                    void run(async () => {
                      await create({
                        articleId,
                        text: highlight.text,
                        startOffset: highlight.startOffset,
                        endOffset: highlight.endOffset,
                        startContainerPath: highlight.startContainerPath,
                        endContainerPath: highlight.endContainerPath,
                      })
                    })
                  }
                >
                  Highlight for yourself
                </Button>
              )
            )}
            {articleId && articleSlug && authorStellarAddress && (
              <HighlightTipButton
                articleId={articleId}
                articleSlug={articleSlug}
                authorName={authorName || 'Author'}
                authorStellarAddress={authorStellarAddress}
                highlightText={highlight.text}
                startOffset={highlight.startOffset}
                endOffset={highlight.endOffset}
                startContainerPath={highlight.startContainerPath}
                endContainerPath={highlight.endContainerPath}
                className="slip-action"
                label="Tip this passage"
                disabled={busy}
              />
            )}
          </div>
          {error && (
            <p role="alert" className="slip-error">
              {error}
            </p>
          )}
          <p className="slip-aside">
            Your highlights are saved to your account. Appreciation and tipping
            are optional.
          </p>
          {(isOwner || savedNote) && (
            <details className="slip-note">
              <summary>
                {savedNote ? 'Saved note' : 'Add a note'} ·{' '}
                {highlight.isPublic ? 'Public' : 'Private'}
              </summary>
              {isOwner ? (
                <form
                  onSubmit={(event) => {
                    event.preventDefault()
                    void run(async () => {
                      await update({ id: highlight._id, note })
                      setSavedNote(note)
                      toast.success('Note updated')
                    })
                  }}
                >
                  <label htmlFor="saved-highlight-note">Highlight note</label>
                  <textarea
                    id="saved-highlight-note"
                    className="highlight-note-input"
                    value={note}
                    onChange={(event) => setNote(event.target.value)}
                    disabled={busy}
                  />
                  <Button type="submit" className="slip-action" disabled={busy}>
                    Save note
                  </Button>
                </form>
              ) : (
                <p>{savedNote}</p>
              )}
            </details>
          )}
        </FocusScope>
      </div>
    </HighlightPaperSlip>
  )
}
