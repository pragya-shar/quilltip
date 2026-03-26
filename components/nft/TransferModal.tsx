'use client'

import { useState } from 'react'
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

interface TransferModalProps {
  isOpen: boolean
  onClose: () => void
  articleId: string
  articleTitle: string
  currentOwner: string
  nftId?: Id<'articleNFTs'>
  onTransferComplete?: (newOwner: string) => void
}

export function TransferModal({
  isOpen,
  onClose,
  articleId,
  articleTitle,
  currentOwner,
  nftId,
  onTransferComplete,
}: TransferModalProps) {
  const [recipientUsername, setRecipientUsername] = useState('')
  const [isTransferring, setIsTransferring] = useState(false)
  const [transferStatus, setTransferStatus] = useState<
    'idle' | 'confirming' | 'success' | 'error'
  >('idle')
  const [errorMessage, setErrorMessage] = useState('')

  const transferNFT = useMutation(api.nfts.transferNFT)

  const nftData = useNFTByArticle(
    !nftId ? (articleId as Id<'articles'>) : undefined
  )

  const actualNftId =
    nftId || (nftData && nftData.isMinted ? nftData._id : null)

  const validateUsername = (username: string): boolean => {
    // Basic username validation
    return /^[a-zA-Z0-9_-]{3,30}$/.test(username)
  }

  const handleTransfer = async () => {
    setErrorMessage('')

    // Validate username
    if (!recipientUsername.trim()) {
      setErrorMessage('Please enter a recipient username')
      return
    }

    if (!validateUsername(recipientUsername)) {
      setErrorMessage(
        'Invalid username format. Use only letters, numbers, underscores, and hyphens (3-30 characters).'
      )
      return
    }

    if (recipientUsername.toLowerCase() === currentOwner.toLowerCase()) {
      setErrorMessage('Cannot transfer to the current owner')
      return
    }

    if (!actualNftId) {
      setErrorMessage('NFT not found for this article')
      return
    }

    setIsTransferring(true)
    setTransferStatus('confirming')

    try {
      const transferId = await transferNFT({
        nftId: actualNftId,
        toUsername: recipientUsername,
      })

      if (transferId) {
        setTransferStatus('success')

        // Show success toast
        toast.success(
          `NFT Transferred Successfully! Article NFT has been transferred to @${recipientUsername}`
        )

        // Notify parent component
        if (onTransferComplete) {
          onTransferComplete(recipientUsername)
        }

        // Close modal after a short delay
        setTimeout(() => {
          handleClose()
        }, 2000)
      } else {
        throw new Error('Transfer failed')
      }
    } catch (error) {
      console.error('Transfer error:', error)
      setTransferStatus('error')
      setErrorMessage(
        error instanceof Error
          ? error.message
          : 'Transfer failed. Please try again.'
      )
      toast.error(error instanceof Error ? error.message : 'Transfer failed')
    } finally {
      setIsTransferring(false)
    }
  }

  const handleClose = () => {
    if (!isTransferring) {
      setRecipientUsername('')
      setTransferStatus('idle')
      setErrorMessage('')
      onClose()
    }
  }

  const getStatusMessage = () => {
    switch (transferStatus) {
      case 'confirming':
        return 'Processing transfer...'
      case 'success':
        return 'Transfer completed successfully!'
      case 'error':
        return errorMessage || 'Transfer failed. Please try again.'
      default:
        return ''
    }
  }

  const getStatusIcon = () => {
    switch (transferStatus) {
      case 'confirming':
        return <Loader2 className="h-4 w-4 animate-spin" />
      case 'success':
        return <CheckCircle className="h-4 w-4 text-green-500" />
      case 'error':
        return <AlertCircle className="h-4 w-4 text-red-500" />
      default:
        return null
    }
  }

  return (
    <Dialog open={isOpen} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Transfer NFT Ownership</DialogTitle>
          <DialogDescription>
            Transfer ownership of &quot;{articleTitle}&quot; to another user.
            This action cannot be undone.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Current Owner */}
          <div className="space-y-2">
            <Label className="text-sm text-muted-foreground">
              Current Owner
            </Label>
            <div className="px-3 py-2 bg-muted rounded-lg text-sm">
              @{currentOwner}
            </div>
          </div>

          {/* Recipient Input */}
          <div className="space-y-2">
            <Label htmlFor="recipient">Transfer To (Username)</Label>
            <Input
              id="recipient"
              placeholder="Enter recipient username"
              value={recipientUsername}
              onChange={(e) => setRecipientUsername(e.target.value)}
              disabled={isTransferring || transferStatus === 'success'}
              className="font-mono"
            />
            <p className="text-xs text-muted-foreground">
              Enter the username of the recipient (e.g., johndoe)
            </p>
          </div>

          {/* Status Message */}
          {transferStatus !== 'idle' && (
            <div
              className={`flex items-center gap-2 p-3 rounded-lg ${
                transferStatus === 'success'
                  ? 'bg-green-50 text-green-700'
                  : transferStatus === 'error'
                    ? 'bg-red-50 text-red-700'
                    : 'bg-blue-50 text-blue-700'
              }`}
            >
              {getStatusIcon()}
              <span className="text-sm">{getStatusMessage()}</span>
            </div>
          )}

          {/* Error Message */}
          {errorMessage && transferStatus === 'idle' && (
            <div className="text-sm text-red-500">{errorMessage}</div>
          )}
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={handleClose}
            disabled={isTransferring}
          >
            Cancel
          </Button>
          <Button
            onClick={handleTransfer}
            disabled={
              isTransferring ||
              transferStatus === 'success' ||
              !recipientUsername.trim()
            }
            className="bg-gradient-to-r from-purple-500 to-pink-500 hover:from-purple-600 hover:to-pink-600"
          >
            {isTransferring ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Transferring...
              </>
            ) : (
              <>
                <Send className="mr-2 h-4 w-4" />
                Transfer NFT
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
