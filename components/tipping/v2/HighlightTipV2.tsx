'use client'

import { lazy, Suspense, useState } from 'react'
import { useQuery } from 'convex/react'
import { Heart } from 'lucide-react'
import { api } from '@/convex/_generated/api'
import type { Id } from '@/convex/_generated/dataModel'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { useLastTipV2 } from '@/hooks/useLastTipV2'
import { highlightScope } from '@/lib/tip/v2/pending'
import { requestOpenBasket } from '@/lib/tip/v2/open-basket'
import { TIP_DIALOG } from '@/lib/copy/tip-flow'
import { cn } from '@/lib/utils'
import { LastTipLine } from './LastTipLine'
import { TipDialogLoading } from './TipDialogLoading'
import '../tipping.css'
import './tip-v2.css'

const TipDialogV2 = lazy(() =>
  import('./TipDialogV2').then((mod) => ({ default: mod.TipDialogV2 }))
)

interface HighlightTipV2Props {
  articleId: Id<'articles'>
  articleSlug: string
  /** For the tip basket row; the dialog shows the passage. */
  articleTitle?: string
  authorName: string
  highlightText: string
  startOffset: number
  endOffset: number
  startContainerPath?: string
  endContainerPath?: string
  className?: string
  label?: string
  /** Runs before the dialog opens; false keeps it closed. */
  onBeforeOpen?: () => Promise<boolean>
  disabled?: boolean
  onSuccess?: () => void
  /** "Done" after a result: the dialog closed; close what opened it too. */
  onDone?: () => void
}

/** The v2 passage tip: the button and its dialog. */
export function HighlightTipV2({
  articleId,
  articleSlug,
  articleTitle = '',
  authorName,
  highlightText,
  startOffset,
  endOffset,
  startContainerPath,
  endContainerPath,
  className,
  label = 'Tip passage',
  onBeforeOpen,
  disabled,
  onSuccess,
  onDone,
}: HighlightTipV2Props) {
  const eligibility = useQuery(api.tipsV2.getTipEligibility, { articleId })
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const last = useLastTipV2(highlightScope(articleId, startOffset, endOffset))

  // The writer's own passage, or an article that cannot take tips: no button.
  if (
    eligibility &&
    (eligibility.reason === 'SELF_TIP' ||
      eligibility.reason === 'ARTICLE_NOT_REGISTERED' ||
      eligibility.reason === 'ARTICLE_NOT_FOUND' ||
      eligibility.reason === 'PAYOUT_ADDRESS_CHANGED')
  ) {
    return null
  }

  const openDialog = async () => {
    if (onBeforeOpen && !(await onBeforeOpen())) return
    setOpen(true)
  }
  const onOpenChange = (next: boolean) => {
    if (!next && busy) return
    setOpen(next)
    if (!next) last.refresh()
  }

  return (
    <>
      <Button
        type="button"
        variant="outline"
        className={cn('tip-trigger gap-2', className)}
        disabled={disabled || eligibility === undefined}
        onClick={() => void openDialog()}
      >
        <Heart className="w-4 h-4" aria-hidden="true" />
        {label}
      </Button>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent
          className="tip-dialog"
          overlayClassName="tip-dialog-overlay"
          aria-busy={busy}
          initialFocus="title"
        >
          <DialogHeader className="tip-dialog-header">
            <DialogTitle>{TIP_DIALOG.highlightTitle}</DialogTitle>
            <DialogDescription className="tip-dialog-description">
              For {authorName} · Selected passage
            </DialogDescription>
          </DialogHeader>
          {open && eligibility ? (
            <Suspense fallback={<TipDialogLoading />}>
              <TipDialogV2
                variant="highlight"
                articleId={articleId}
                articleSlug={articleSlug}
                articleTitle={articleTitle}
                authorName={authorName}
                eligibility={eligibility}
                highlight={{
                  text: highlightText,
                  startOffset,
                  endOffset,
                  startContainerPath,
                  endContainerPath,
                }}
                onBusyChange={setBusy}
                onOpenBasket={() => {
                  setOpen(false)
                  requestOpenBasket()
                }}
                onDone={() => {
                  setOpen(false)
                  last.refresh()
                  onDone?.()
                }}
                onConfirmed={onSuccess}
              />
            </Suspense>
          ) : null}
        </DialogContent>
      </Dialog>
      {last.pending && last.status && !open ? (
        <LastTipLine
          uiState={last.status.uiState}
          onView={() => setOpen(true)}
        />
      ) : null}
    </>
  )
}
