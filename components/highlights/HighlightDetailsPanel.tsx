'use client'

import { useState, useMemo, useRef } from 'react'
import { useMutation } from 'convex/react'
import { api } from '@/convex/_generated/api'
import { useHighlightTipsByHighlight } from '@/hooks/convex'
import type { Id } from '@/types/convex'
import { FocusScope } from '@radix-ui/react-focus-scope'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import {
  X,
  Coins,
  User,
  Calendar,
  MessageSquare,
  Edit,
  Trash2,
  Loader2,
  TrendingUp,
} from 'lucide-react'
import { HighlightTipButton } from './HighlightTipButton'
import { formatTipAmount } from '@/lib/stellar/highlight-utils'
import { UserAvatar } from '@/components/ui/user-avatar'
import { Button } from '@/components/ui/button'
import { toast } from 'sonner'
import { useHighlightPanelDismiss } from '@/hooks/useHighlightPanelDismiss'
import { useSuspendDialogModalForWallet } from '@/hooks/useSuspendDialogModalForWallet'
import { useClampedFixedPosition } from '@/hooks/useClampedFixedPosition'

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
  position,
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
  const [isEditing, setIsEditing] = useState(false)
  const [savedNote, setSavedNote] = useState(highlight.note || '')
  const [isSaving, setIsSaving] = useState(false)
  const [errorMessage, setErrorMessage] = useState('')
  const [editedNote, setEditedNote] = useState(highlight.note || '')
  const [isDeleting, setIsDeleting] = useState(false)
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false)
  const panelRef = useRef<HTMLDivElement>(null)
  const editButtonRef = useRef<HTMLButtonElement>(null)
  const deleteButtonRef = useRef<HTMLButtonElement>(null)
  const closeButtonRef = useRef<HTMLButtonElement>(null)
  const clampedPosition = useClampedFixedPosition(position, panelRef, {
    fallbackWidth: 448,
    fallbackHeight: 400,
  })

  useHighlightPanelDismiss(
    onClose,
    !deleteConfirmOpen && !isDeleting && !isSaving && !walletConnectionActive
  )

  // Check if current user owns this highlight
  const isOwner = currentUserId && currentUserId === highlight.userId

  // Fetch tip statistics for this highlight
  const highlightTips = useHighlightTipsByHighlight(highlight.highlightId)

  // Mutations
  const updateHighlight = useMutation(api.highlights.updateHighlight)
  const deleteHighlight = useMutation(api.highlights.deleteHighlight)

  // Calculate tip stats
  const tipStats = useMemo(() => {
    if (!highlightTips) return { count: 0, totalCents: 0, totalUsd: 0 }

    return {
      count: highlightTips.tipCount,
      totalCents: highlightTips.totalAmountCents,
      totalUsd: highlightTips.totalAmountUsd,
    }
  }, [highlightTips])

  // Handle note update
  const handleSaveNote = async () => {
    if (!isOwner || isSaving) return
    setIsSaving(true)
    setErrorMessage('')
    try {
      await updateHighlight({
        id: highlight._id,
        note: editedNote,
      })
      setSavedNote(editedNote)
      setIsEditing(false)
      requestAnimationFrame(() => editButtonRef.current?.focus())
      toast.success('Note updated successfully')
    } catch (error) {
      console.error('Failed to update note:', error)
      toast.error('Failed to update note')
      setErrorMessage(
        'Your note could not be saved. Your changes are still here; try again.'
      )
    } finally {
      setIsSaving(false)
    }
  }

  const handleConfirmDelete = async () => {
    if (!isOwner || isDeleting) return
    setErrorMessage('')
    setIsDeleting(true)
    try {
      await deleteHighlight({ id: highlight._id })
      toast.success('Highlight deleted')
      setDeleteConfirmOpen(false)
      onDeleted?.(highlight._id)
      onClose()
    } catch (error) {
      console.error('Failed to delete highlight:', error)
      toast.error('Failed to delete highlight')
      setErrorMessage('The highlight could not be deleted. Please try again.')
      setIsDeleting(false)
    }
  }

  // Truncate text for display
  const displayText =
    highlight.text.length > 150
      ? highlight.text.slice(0, 150) + '...'
      : highlight.text
  const confirmSnippet =
    highlight.text.trim().length > 90
      ? `${highlight.text.trim().slice(0, 90)}…`
      : highlight.text.trim()

  return (
    <div
      ref={panelRef}
      className="highlight-details-panel fixed z-50 w-[400px] max-w-[calc(100vw-24px)] outline-none"
      style={{
        top: clampedPosition.top,
        left: clampedPosition.left,
      }}
      role="dialog"
      aria-modal={!walletConnectionActive}
      aria-label="Highlight details"
      tabIndex={-1}
    >
      <FocusScope
        trapped={!deleteConfirmOpen && !walletConnectionActive}
        loop
        onUnmountAutoFocus={(event) => {
          event.preventDefault()
          onRestoreFocus?.()
        }}
        onMountAutoFocus={(e) => {
          e.preventDefault()
          closeButtonRef.current?.focus()
        }}
      >
        {/* Header */}
        <div className="flex items-start justify-between p-4 border-b border-ui-border">
          <div className="min-w-0 flex-1">
            <h3 className="highlight-panel-title">Saved passage</h3>
            <div className="highlight-visibility">
              {highlight.isPublic ? 'Public' : 'Private'}
            </div>
          </div>
          <button
            ref={closeButtonRef}
            type="button"
            onClick={onClose}
            aria-label="Close highlight details"
            className="highlight-quiet-action -mr-2 -mt-2"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Highlighted Text */}
        <div className="p-4 border-b border-ui-border">
          <div
            className="highlight-text-preview !mb-0"
            style={{ borderLeftColor: highlight.color || '#F59E0B' }}
          >
            &ldquo;{displayText}&rdquo;
          </div>
        </div>

        {/* Creator Info */}
        <div className="px-4 py-3 border-b border-ui-border">
          <div className="flex items-center gap-3">
            <UserAvatar
              src={highlight.userAvatar}
              alt={highlight.userName || 'User'}
              name={highlight.userName || 'Anonymous'}
              className="h-8 w-8"
            />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <User className="w-3 h-3 text-ui-muted-foreground" />
                <span className="text-sm font-medium text-ui-foreground">
                  {highlight.userName || 'Anonymous'}
                </span>
              </div>
              <div className="flex items-center gap-2 mt-0.5">
                <Calendar className="w-3 h-3 text-ui-muted-foreground" />
                <span className="text-xs text-ui-muted-foreground">
                  {new Date(highlight.createdAt).toLocaleDateString('en-US', {
                    month: 'short',
                    day: 'numeric',
                    year: 'numeric',
                  })}
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Note Section */}
        {(savedNote || isOwner) && (
          <div className="px-4 py-3 border-b border-ui-border">
            <div className="flex items-center gap-2 mb-2">
              <MessageSquare className="w-4 h-4 text-ui-muted-foreground" />
              <span className="text-xs font-medium text-ui-muted-foreground">
                Note
              </span>
            </div>

            {isEditing ? (
              <div className="space-y-2">
                <textarea
                  aria-label="Highlight note"
                  disabled={isSaving}
                  value={editedNote}
                  onChange={(e) => setEditedNote(e.target.value)}
                  placeholder="Add a note to your highlight..."
                  className="highlight-note-input"
                  rows={3}
                  // eslint-disable-next-line jsx-a11y/no-autofocus
                  autoFocus
                />
                <div className="flex gap-2">
                  <Button
                    type="button"
                    size="sm"
                    onClick={handleSaveNote}
                    disabled={isSaving}
                    className="min-w-0 min-h-11 flex-1"
                  >
                    {isSaving ? 'Saving…' : 'Save note'}
                  </Button>
                  <button
                    onClick={() => {
                      setEditedNote(savedNote)
                      setErrorMessage('')
                      requestAnimationFrame(() =>
                        editButtonRef.current?.focus()
                      )
                      setIsEditing(false)
                    }}
                    disabled={isSaving}
                    className="highlight-quiet-action flex-1"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <div className="whitespace-pre-wrap text-sm leading-relaxed text-ui-foreground">
                {savedNote || (
                  <span className="text-ui-muted-foreground italic">
                    No note added
                  </span>
                )}
              </div>
            )}
          </div>
        )}

        {/* Passage support */}
        {tipStats.count > 0 && (
          <div className="px-4 py-3 border-b border-ui-border bg-ui-muted/40">
            <div className="flex items-center gap-2 mb-2">
              <TrendingUp className="w-4 h-4 text-ui-primary" />
              <span className="text-xs font-medium text-ui-foreground">
                Passage support
              </span>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <div className="text-xs text-ui-muted-foreground">
                  Total Tips
                </div>
                <div className="text-lg font-semibold text-ui-foreground">
                  {tipStats.count}
                </div>
              </div>
              <div>
                <div className="text-xs text-ui-muted-foreground">
                  Total tipped
                </div>
                <div className="text-lg font-semibold text-ui-foreground">
                  {formatTipAmount(tipStats.totalCents)}
                </div>
              </div>
            </div>
          </div>
        )}

        {errorMessage && (
          <p role="alert" className="px-4 py-3 text-sm text-ui-danger">
            {errorMessage}
          </p>
        )}

        {/* Actions */}
        <div className="p-4">
          {isOwner ? (
            // Owner actions: Edit & Delete
            <div className="space-y-2">
              {!isEditing && (
                <>
                  <Button
                    type="button"
                    variant="secondary"
                    ref={editButtonRef}
                    onClick={() => {
                      setEditedNote(savedNote)
                      setIsEditing(true)
                      setErrorMessage('')
                    }}
                    className="w-full min-h-11 gap-2"
                  >
                    <Edit className="w-4 h-4" />
                    <span>Edit Note</span>
                  </Button>
                  <Button
                    type="button"
                    variant="destructive"
                    ref={deleteButtonRef}
                    onClick={() => setDeleteConfirmOpen(true)}
                    disabled={isDeleting}
                    className="w-full min-h-11 gap-2"
                  >
                    {isDeleting ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin" />
                        <span>Deleting...</span>
                      </>
                    ) : (
                      <>
                        <Trash2 className="w-4 h-4" />
                        <span>Delete Highlight</span>
                      </>
                    )}
                  </Button>
                </>
              )}
            </div>
          ) : (
            // Non-owner action: Tip
            articleId &&
            articleSlug &&
            authorStellarAddress && (
              <div className="space-y-2">
                <div className="flex items-center gap-2 text-xs text-ui-muted-foreground mb-2">
                  <Coins className="w-3 h-3" />
                  <span>Support this insight</span>
                </div>
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
                  className="w-full justify-center"
                  onSuccess={() => {
                    toast.success('Tip sent! Statistics will update shortly')
                    // Panel stays open to show updated stats
                  }}
                />
                {tipStats.count === 0 && (
                  <p className="text-xs text-center text-ui-muted-foreground mt-2">
                    No support for this highlight yet
                  </p>
                )}
              </div>
            )
          )}
        </div>

        {/* Footer hint */}
        {!isOwner && tipStats.count > 0 && (
          <div className="px-4 pb-3 text-xs text-center text-ui-muted-foreground">
            {tipStats.count}{' '}
            {tipStats.count === 1 ? 'person has' : 'people have'} tipped this
            highlight
          </div>
        )}
      </FocusScope>

      <AlertDialog
        open={deleteConfirmOpen}
        onOpenChange={(open) => {
          if (isDeleting) return
          setDeleteConfirmOpen(open)
        }}
      >
        <AlertDialogContent
          onCloseAutoFocus={(event) => {
            event.preventDefault()
            deleteButtonRef.current?.focus()
          }}
        >
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this highlight?</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-3">
                <p className="text-sm text-ui-muted-foreground">
                  This will permanently delete the highlight and its note. This
                  action cannot be undone.
                </p>
                {confirmSnippet.length > 0 ? (
                  <div className="highlight-text-preview !mb-0">
                    <div className="text-[11px] font-medium uppercase tracking-wide text-ui-muted-foreground">
                      Highlight
                    </div>
                    <p className="mt-1 italic">
                      &ldquo;{confirmSnippet}&rdquo;
                    </p>
                  </div>
                ) : null}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={isDeleting}
              className="bg-ui-danger text-ui-danger-foreground hover:bg-ui-danger/90 disabled:opacity-50 disabled:cursor-not-allowed"
              onClick={(e) => {
                e.preventDefault()
                void handleConfirmDelete()
              }}
            >
              {isDeleting ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Deleting...
                </>
              ) : (
                'Delete highlight'
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
