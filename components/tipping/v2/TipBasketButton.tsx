'use client'

import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import { useQuery } from 'convex/react'
import { Check, ShoppingBasket } from 'lucide-react'
import { api } from '@/convex/_generated/api'
import type { Id } from '@/convex/_generated/dataModel'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { useTipBasket } from '@/hooks/useTipBasket'
import { useWideLayout } from '@/hooks/useWideLayout'
import { BASKET_COPY } from '@/lib/copy/tip-flow'
import { moneyMayHaveMoved } from '@/lib/tip/v2/flow'
import { OPEN_BASKET_EVENT } from '@/lib/tip/v2/open-basket'
import { TipDialogLoading } from './TipDialogLoading'
import './tip-v2.css'

// The basket's payment code loads when the reader opens it.
const TipBasketPanel = lazy(() =>
  import('./TipBasketPanel').then((mod) => ({ default: mod.TipBasketPanel }))
)

/**
 * The tip basket's button and sheet. The button shows while the basket holds
 * a tip or a basket payment has a result to show. The sheet opens from the
 * right at 768 px and wider, from the bottom below that.
 */
export function TipBasketButton() {
  const { state, signedIn } = useTipBasket()
  const wide = useWideLayout()
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const buttonRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    const onOpen = () => setOpen(true)
    window.addEventListener(OPEN_BASKET_EVENT, onOpen)
    return () => window.removeEventListener(OPEN_BASKET_EVENT, onOpen)
  }, [])

  // Once the basket's payment moved money, its tips are no longer waiting to
  // be paid: they leave the count before "Done", and after a reload.
  const status = useQuery(
    api.tipsV2.getTipStatus,
    signedIn && state.submissionId
      ? { submissionId: state.submissionId as Id<'chainSubmissions'> }
      : 'skip'
  )
  const paid = moneyMayHaveMoved(status?.uiState)
  const sentIds = new Set((state.sent ?? []).map((item) => item.id))
  const count = paid
    ? state.items.filter((item) => !sentIds.has(item.id)).length
    : state.items.length
  const visible = signedIn && (count > 0 || state.submissionId !== null)
  if (!visible && !open) return null

  return (
    <div className="tip-basket-dock">
      {visible ? (
        <button
          ref={buttonRef}
          type="button"
          className="tip-basket-button"
          aria-label={
            paid && count === 0
              ? BASKET_COPY.triggerSent
              : BASKET_COPY.trigger(count)
          }
          aria-haspopup="dialog"
          aria-expanded={open}
          onClick={() => setOpen(true)}
        >
          <ShoppingBasket aria-hidden="true" />
          <span aria-hidden="true">{BASKET_COPY.title}</span>
          <span className="tip-basket-count" aria-hidden="true">
            {paid && count === 0 ? <Check /> : count}
          </span>
        </button>
      ) : null}
      <Sheet
        open={open}
        onOpenChange={(next) => {
          if (!next && busy) return
          setOpen(next)
        }}
      >
        <SheetContent
          initialFocus="title"
          side={wide ? 'right' : 'bottom'}
          className="tip-basket-sheet"
          data-side={wide ? 'right' : 'bottom'}
          aria-busy={busy}
          onCloseAutoFocus={(event) => {
            // Return focus to the basket button when it is still there.
            if (buttonRef.current) {
              event.preventDefault()
              buttonRef.current.focus()
            }
          }}
        >
          <SheetHeader className="tip-basket-header">
            <SheetTitle>{BASKET_COPY.title}</SheetTitle>
            <SheetDescription>{BASKET_COPY.description}</SheetDescription>
          </SheetHeader>
          {open ? (
            <Suspense fallback={<TipDialogLoading />}>
              <TipBasketPanel
                onBusyChange={setBusy}
                onClose={() => setOpen(false)}
              />
            </Suspense>
          ) : null}
        </SheetContent>
      </Sheet>
    </div>
  )
}
