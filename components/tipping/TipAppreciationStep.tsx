'use client'

import { ArrowRight } from 'lucide-react'
import {
  calculateTipBreakdown,
  formatTipAmount,
} from '@/lib/stellar/highlight-utils'
import { TIP_MIN_USD, TIP_MAX_USD } from '@/lib/constants'
import { TipHowItWorks } from '@/components/tipping/TipHowItWorks'
import { Button } from '@/components/ui/button'

type TipPreset = {
  readonly cents: number
  readonly label: string
  readonly popular: boolean
}

interface TipAppreciationStepProps {
  variant: 'article' | 'highlight'
  authorName: string
  highlightText?: string
  presets: readonly TipPreset[]
  selectedAmount: number | null
  customAmount: string
  tipMessage?: string
  onSelectedAmountChange: (cents: number | null) => void
  onCustomAmountChange: (value: string) => void
  onTipMessageChange?: (value: string) => void
  onContinue: () => void
  onCancel: () => void
  isLoading: boolean
  canContinue: boolean
  priceUsd: number | null
  idPrefix?: string
}

export function TipAppreciationStep({
  variant,
  authorName,
  highlightText,
  presets,
  selectedAmount,
  customAmount,
  tipMessage = '',
  onSelectedAmountChange,
  onCustomAmountChange,
  onTipMessageChange,
  onContinue,
  onCancel,
  isLoading,
  canContinue,
  priceUsd,
  idPrefix = 'tip',
}: TipAppreciationStepProps) {
  const previewCents = selectedAmount || parseFloat(customAmount) * 100
  const tipBreakdownPreview =
    Number.isFinite(previewCents) && previewCents > 0
      ? calculateTipBreakdown(previewCents)
      : null

  const displayHighlightText =
    highlightText && highlightText.length > 60
      ? highlightText.slice(0, 60) + '...'
      : highlightText

  return (
    <>
      {variant === 'highlight' && displayHighlightText ? (
        <div className="p-3 bg-warning/10 border border-warning/50 rounded-lg">
          <p className="text-sm text-foreground italic">
            &ldquo;{displayHighlightText}&rdquo;
          </p>
        </div>
      ) : null}

      <p className="text-muted-foreground text-sm">
        {variant === 'article'
          ? `Choose an amount to support ${authorName}.`
          : `Support ${authorName} for this passage.`}
      </p>

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        {presets.map((amount) => (
          <button
            key={amount.cents}
            type="button"
            onClick={() => {
              onSelectedAmountChange(amount.cents)
              onCustomAmountChange('')
            }}
            disabled={isLoading}
            className={`focus-ring relative flex min-h-12 items-center justify-center px-4 py-3 rounded-lg border transition-colors disabled:opacity-50 ${
              selectedAmount === amount.cents
                ? 'border-primary bg-primary/5'
                : 'border-border hover:border-primary/40'
            }`}
          >
            {amount.popular && (
              <span className="absolute -top-2 left-1/2 transform -translate-x-1/2 px-2 py-0.5 bg-primary text-primary-foreground text-xs rounded-full">
                Popular
              </span>
            )}
            <span className="font-semibold">{amount.label}</span>
          </button>
        ))}
      </div>

      <div>
        <label
          htmlFor={`${idPrefix}-custom-amount`}
          className="block text-sm font-medium text-foreground mb-2"
        >
          Or enter custom amount
        </label>
        <div className="relative">
          <span className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground">
            $
          </span>
          <input
            id={`${idPrefix}-custom-amount`}
            type="number"
            min={TIP_MIN_USD}
            max={TIP_MAX_USD}
            step="0.01"
            value={customAmount}
            onChange={(e) => {
              onCustomAmountChange(e.target.value)
              onSelectedAmountChange(null)
            }}
            disabled={isLoading}
            placeholder="0.00"
            className="focus-ring w-full pl-8 pr-4 py-2 border border-input bg-background text-foreground rounded-lg disabled:opacity-50"
          />
        </div>
        <p className="text-xs text-muted-foreground mt-1">
          Minimum: ${TIP_MIN_USD.toFixed(2)} • Maximum: $
          {TIP_MAX_USD.toFixed(2)}
        </p>
      </div>

      {variant === 'article' && onTipMessageChange ? (
        <div>
          <label
            htmlFor={`${idPrefix}-optional-message`}
            className="block text-sm font-medium text-foreground mb-2"
          >
            Message to author (optional)
          </label>
          <textarea
            id={`${idPrefix}-optional-message`}
            value={tipMessage}
            onChange={(e) => onTipMessageChange(e.target.value)}
            disabled={isLoading}
            maxLength={500}
            rows={3}
            placeholder="Say thanks or leave context for your tip..."
            className="focus-ring w-full resize-none rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground disabled:opacity-50"
          />
          <p className="mt-1 text-xs text-muted-foreground">
            {tipMessage.length}/500 characters
          </p>
        </div>
      ) : null}

      <TipHowItWorks
        priceUsd={priceUsd}
        totalFormatted={
          tipBreakdownPreview ? formatTipAmount(previewCents) : undefined
        }
        authorFormatted={tipBreakdownPreview?.authorShareFormatted}
        platformFeeFormatted={tipBreakdownPreview?.platformFeeFormatted}
      />

      <div className="flex gap-3">
        <Button
          type="button"
          variant="outline"
          onClick={onCancel}
          disabled={isLoading}
          className="flex-1"
        >
          Cancel
        </Button>
        <Button
          type="button"
          onClick={onContinue}
          disabled={isLoading || !canContinue}
          className="flex-1 gap-2"
        >
          Continue
          <ArrowRight className="w-4 h-4" />
        </Button>
      </div>
    </>
  )
}
