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
  DialogTrigger,
} from '@/components/ui/dialog'
import { TipButtonSkeleton } from '@/components/articles/TipButtonSkeleton'
import { TipsUnavailableNote } from '@/components/tipping/TipsUnavailableNote'
import { useLastTipV2 } from '@/hooks/useLastTipV2'
import { articleScope } from '@/lib/tip/v2/pending'
import { requestOpenBasket } from '@/lib/tip/v2/open-basket'
import { TIP_DIALOG } from '@/lib/copy/tip-flow'
import { cn } from '@/lib/utils'
import { LastTipLine } from './LastTipLine'
import { TipBasketButton } from './TipBasketButton'
import { TipDialogLoading } from './TipDialogLoading'
import '../tipping.css'
import './tip-v2.css'

// The form, the payment kit, the wallet and RPC code load when the reader
// opens the dialog, not with the article page.
const TipDialogV2 = lazy(() =>
  import('./TipDialogV2').then((mod) => ({ default: mod.TipDialogV2 }))
)

interface ArticleTipV2Props {
  articleId: Id<'articles'>
  articleTitle: string
  articleSlug: string
  authorName: string
  className?: string
}

/** The v2 article tip: the button, its dialog, and the page's tip basket. */
export function ArticleTipV2({
  articleId,
  articleTitle,
  articleSlug,
  authorName,
  className,
}: ArticleTipV2Props) {
  const eligibility = useQuery(api.tipsV2.getTipEligibility, { articleId })
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const last = useLastTipV2(articleScope(articleId))

  if (eligibility === undefined) return <TipButtonSkeleton />
  const unavailable =
    eligibility.reason === 'ARTICLE_NOT_REGISTERED' ||
    eligibility.reason === 'ARTICLE_NOT_FOUND'
      ? 'unregistered'
      : eligibility.reason === 'PAYOUT_ADDRESS_CHANGED'
        ? 'payout_outdated'
        : null
  if (unavailable) {
    return (
      <>
        <TipsUnavailableNote reason={unavailable} />
        <TipBasketButton />
      </>
    )
  }
  // Tips for the reader's own article come to them: no tip button.
  if (eligibility.reason === 'SELF_TIP') return <TipBasketButton />

  const onOpenChange = (next: boolean) => {
    // A wallet step is running: keep the dialog until it answers.
    if (!next && busy) return
    setOpen(next)
    if (!next) last.refresh()
  }

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogTrigger asChild>
          <Button
            variant="outline"
            className={cn('tip-trigger gap-2', className)}
          >
            <Heart className="w-4 h-4" aria-hidden="true" />
            Tip article
          </Button>
        </DialogTrigger>
        <DialogContent
          className="tip-dialog"
          initialFocus="title"
          overlayClassName="tip-dialog-overlay"
          aria-busy={busy}
        >
          <DialogHeader className="tip-dialog-header">
            <DialogTitle>{TIP_DIALOG.articleTitle}</DialogTitle>
            <DialogDescription className="tip-dialog-description">
              For {authorName} · Whole article
            </DialogDescription>
          </DialogHeader>
          {open ? (
            <Suspense fallback={<TipDialogLoading />}>
              <TipDialogV2
                variant="article"
                articleId={articleId}
                articleSlug={articleSlug}
                articleTitle={articleTitle}
                authorName={authorName}
                eligibility={eligibility}
                onBusyChange={setBusy}
                onOpenBasket={() => {
                  setOpen(false)
                  requestOpenBasket()
                }}
                onDone={() => {
                  setOpen(false)
                  last.refresh()
                }}
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
      <TipBasketButton />
    </>
  )
}
