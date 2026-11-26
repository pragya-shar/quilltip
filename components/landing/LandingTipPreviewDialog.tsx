'use client'

import { WalletSetupHelp } from '@/components/stellar/WalletSetupHelp'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import { Heart, X } from './LandingIcons'

/**
 * The landing demo's "Add a tip" dialog: a receipt preview with test XLM
 * amounts. No wallet connects and no payment is made. LandingTippingDemo
 * loads it on demand.
 */
export function LandingTipPreviewDialog({
  open,
  onOpenChange,
  sentence,
  amount,
  onAmountChange,
  onPreview,
  onCloseAutoFocus,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  sentence: string
  amount: string
  onAmountChange: (amount: string) => void
  onPreview: () => void
  onCloseAutoFocus: (event: Event) => void
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="landing-blend blend-study type-study landing-tip-dialog"
        overlayClassName="landing-tip-overlay"
        hideCloseButton
        onCloseAutoFocus={onCloseAutoFocus}
      >
        <DialogClose asChild>
          <button
            type="button"
            className="icon-button modal-close"
            aria-label="Close tip dialog"
          >
            <X size={22} />
          </button>
        </DialogClose>
        <DialogTitle>Preview a little appreciation.</DialogTitle>
        <DialogDescription>
          A little support for the words that stayed with you.
        </DialogDescription>
        <blockquote>“{sentence}”</blockquote>
        <form
          onSubmit={(event) => {
            event.preventDefault()
            onPreview()
          }}
        >
          <fieldset>
            <legend>
              Choose a demo amount · test XLM has no monetary value
            </legend>
            <div className="amounts">
              {['1', '2', '5'].map((value) => (
                <label key={value} className={amount === value ? 'chosen' : ''}>
                  <input
                    type="radio"
                    name="amount"
                    value={value}
                    checked={amount === value}
                    onChange={() => onAmountChange(value)}
                  />
                  {value} test XLM
                </label>
              ))}
            </div>
            <button className="button primary send-tip" type="submit">
              Preview {amount} test XLM receipt <Heart size={18} aria-hidden />
            </button>
          </fieldset>
        </form>
        <p className="modal-disclaimer">
          Quick receipt preview · no wallet connects or payment is made.
        </p>
        <WalletSetupHelp />
      </DialogContent>
    </Dialog>
  )
}
