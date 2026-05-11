'use client'

import { useEffect, useRef, useState, type RefObject } from 'react'
import { useMutation } from 'convex/react'
import { api } from '@/convex/_generated/api'
import { useNFTByArticle } from '@/hooks/convex'
import type { Id } from '@/types/convex'
import { Loader2, CheckCircle, AlertCircle, Send } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { userFacingTransferNftError } from '@/lib/convex/userFacingTransferNftError'

type TransferMessage =
  | { kind: 'none' }
  | { kind: 'progress'; text: string }
  | { kind: 'success'; text: string }
  | { kind: 'error'; text: string }

const PROGRESS_COPY = 'Processing transfer...'
const SUCCESS_COPY = 'Transfer completed successfully!'

interface TransferModalProps {
  isOpen: boolean
  onClose: () => void
  articleId: string
  articleTitle: string
  currentOwner: string
  nftId?: Id<'articleNFTs'>
  onTransferComplete?: (newOwner: string) => void
  triggerRef?: RefObject<HTMLElement | null>
}

export function TransferModal({
  isOpen,
  onClose,
  articleId,
  articleTitle,
  currentOwner,
  nftId,
  onTransferComplete,
  triggerRef,
}: TransferModalProps) {
  const [recipientUsername, setRecipientUsername] = useState('')
  const [transferMessage, setTransferMessage] = useState<TransferMessage>({
    kind: 'none',
  })

  const transferNFT = useMutation(api.nfts.transferNFT)

  const nftData = useNFTByArticle(
    !nftId ? (articleId as Id<'articles'>) : undefined
  )

  const actualNftId =
    nftId || (nftData && nftData.isMinted ? nftData._id : null)

  const prevOpenRef = useRef(false)

  useEffect(() => {
    if (isOpen && !prevOpenRef.current) {
      setRecipientUsername('')
      setTransferMessage({ kind: 'none' })
    }
    prevOpenRef.current = isOpen
  }, [isOpen])

  const isBusy = transferMessage.kind === 'progress'

  const validateUsername = (username: string): boolean => {
    return /^[a-zA-Z0-9_-]{3,30}$/.test(username)
  }

  const handleTransfer = async () => {
    setTransferMessage({ kind: 'none' })

    if (!recipientUsername.trim()) {
      setTransferMessage({
        kind: 'error',
        text: 'Please enter a recipient username',
      })
      return
    }

    if (!validateUsername(recipientUsername)) {
      setTransferMessage({
        kind: 'error',
        text: 'Invalid username format. Use only letters, numbers, underscores, and hyphens (3-30 characters).',
      })
      return
    }

    if (recipientUsername.toLowerCase() === currentOwner.toLowerCase()) {
      setTransferMessage({
        kind: 'error',
        text: 'Cannot transfer to the current owner',
      })
      return
    }

    if (!actualNftId) {
      setTransferMessage({
        kind: 'error',
        text: 'NFT not found for this article',
      })
      return
    }

    setTransferMessage({ kind: 'progress', text: PROGRESS_COPY })

    try {
      const transferId = await transferNFT({
        nftId: actualNftId,
        toUsername: recipientUsername,
      })

      if (transferId) {
        setTransferMessage({ kind: 'success', text: SUCCESS_COPY })

        toast.success(
          `NFT Transferred Successfully! Article NFT has been transferred to @${recipientUsername}`
        )

        if (onTransferComplete) {
          onTransferComplete(recipientUsername)
        }

        setTimeout(() => {
          handleClose()
        }, 2000)
      } else {
        throw new Error('Transfer failed')
      }
    } catch (error) {
      const text = userFacingTransferNftError(error)
      setTransferMessage({ kind: 'error', text })
      toast.error(text)
    }
  }

  const handleClose = () => {
    if (isBusy) return
    setRecipientUsername('')
    setTransferMessage({ kind: 'none' })
    onClose()
  }

  const messageBannerClass =
    transferMessage.kind === 'success'
      ? 'bg-green-50 text-green-700'
      : transferMessage.kind === 'error'
        ? 'bg-red-50 text-red-700'
        : transferMessage.kind === 'progress'
          ? 'bg-blue-50 text-blue-700'
          : ''

  const messageIcon =
    transferMessage.kind === 'progress' ? (
      <Loader2 className="h-4 w-4 shrink-0 animate-spin" />
    ) : transferMessage.kind === 'success' ? (
      <CheckCircle className="h-4 w-4 shrink-0 text-green-500" />
    ) : transferMessage.kind === 'error' ? (
      <AlertCircle className="h-4 w-4 shrink-0 text-red-500" />
    ) : null

  return (
    <Dialog
      open={isOpen}
      onOpenChange={(open) => {
        if (!open) handleClose()
      }}
    >
      <DialogContent
        className="w-[calc(100vw-2rem)] sm:max-w-md"
        onCloseAutoFocus={(e) => {
          if (triggerRef?.current) {
            e.preventDefault()
            triggerRef.current.focus()
          }
        }}
        onEscapeKeyDown={(e) => {
          if (isBusy) e.preventDefault()
        }}
        onInteractOutside={(e) => {
          if (isBusy) e.preventDefault()
        }}
      >
        <DialogHeader>
          <DialogTitle>Transfer NFT Ownership</DialogTitle>
          <DialogDescription>
            Transfer ownership of &quot;{articleTitle}&quot; to another user.
            This action cannot be undone.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label className="text-sm text-muted-foreground">
              Current Owner
            </Label>
            <div className="max-w-full overflow-hidden px-3 py-2 bg-muted rounded-lg text-sm font-mono break-all">
              @{currentOwner}
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="recipient">Transfer To (Username)</Label>
            <Input
              id="recipient"
              placeholder="Enter recipient username"
              value={recipientUsername}
              onChange={(e) => setRecipientUsername(e.target.value)}
              disabled={isBusy || transferMessage.kind === 'success'}
              className="font-mono"
            />
            <p className="text-xs text-muted-foreground">
              Enter the username of the recipient (e.g., johndoe)
            </p>
          </div>

          <div
            className="flex min-h-[3.75rem] items-center rounded-lg"
            data-testid="transfer-modal-message"
            aria-live="polite"
          >
            {transferMessage.kind === 'none' ? (
              <span className="sr-only">No transfer status</span>
            ) : (
              <div
                className={`flex w-full items-center gap-2 rounded-lg p-3 ${messageBannerClass}`}
              >
                {messageIcon}
                <span className="min-w-0 text-sm break-words">
                  {transferMessage.text}
                </span>
              </div>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={handleClose} disabled={isBusy}>
            Cancel
          </Button>
          <Button
            onClick={handleTransfer}
            disabled={
              isBusy ||
              transferMessage.kind === 'success' ||
              !recipientUsername.trim()
            }
            aria-busy={isBusy}
            className="bg-gradient-to-r from-purple-500 to-pink-500 hover:from-purple-600 hover:to-pink-600"
          >
            {isBusy ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />
                Transfer NFT
              </>
            ) : (
              <>
                <Send className="mr-2 h-4 w-4" aria-hidden />
                Transfer NFT
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
